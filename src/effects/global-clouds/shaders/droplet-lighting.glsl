// Dual-lobe droplet scattering, integrated for both directional light sources.
// |g| <= .9 in the public parameters. Its smallest legal denominator is .01;
// .015 clipped the forward lobe and lost energy. Clamp only cosine roundoff.
float waterPhase(float c,float g){return (1.-g*g)/(4.*PI*pow(1.+g*g-2.*g*clamp(c,-1.,1.),1.5));}
vec3 waterPhases(float c){
    vec3 result;float eccentricity=1.;
    for(int j=0;j<3;j++){
        result[j]=mix(waterPhase(c,.8*eccentricity),waterPhase(c,-.2*eccentricity),.5);
        eccentricity*=.5;
    }
    return result;
}
uniform sampler2D u_skyIrradiance;
uniform bool u_hasSkyIrradiance;
void cloudEnvironment(vec3 p,out vec3 sky,out vec3 horizon){
    vec3 up=normalize(p);sky=vec3(.035,.05,.075);horizon=vec3(.055,.06,.07);
    if(u_atmosphere){
        if(u_hasSkyIrradiance){sampleSkyIrradiance(u_skyIrradiance,p,u_sun,sky,horizon);return;}
        // Compatibility for third-party CloudLighting without the diffuse LUT.
        // This older two-direction approximation is local, but is not E/PI.
        vec3 transmission;
        vec3 tangent=u_sun-up*dot(up,u_sun);
        if(dot(tangent,tangent)<.001)tangent=cross(up,abs(up.z)>.9?vec3(1,0,0):vec3(0,0,1));
        integrateAtmosphere(p,up,150.,10,sky,transmission);
        integrateAtmosphere(p,normalize(normalize(tangent)+up*.35),250.,10,horizon,transmission);
    }else{
        float day=smoothstep(-.12,.15,dot(up,u_sun));sky*=day;horizon*=day;
    }
}
CloudPhases scatteringPhases(vec3 d){
    #ifdef LAYERED_CLOUDS
    if(cloudLayer==1)return CloudPhases(vec3(waterPhase(dot(d,u_sun),u_highAnisotropy),0,0),vec3(waterPhase(dot(d,u_moon),u_highAnisotropy),0,0));
    #endif
    return CloudPhases(waterPhases(dot(d,u_sun)),waterPhases(dot(d,u_moon)));
}
#ifdef LAYERED_CLOUDS
vec3 iceDirectional(vec3 p,vec3 light,float phase){
    if(planetOccludes(p,light))return vec3(0);
    vec2 outer=sphere(p,light,Rg+u_highBase+u_highThickness),inner=sphere(p,light,Rg+u_highBase);
    float end=max(0.,outer.y);if(inner.x>0.)end=min(end,inner.x);
    // Local column held fixed along a finite curved light path. No droplet
    // powder/base shadow and no inverse-cosine cap. Inter-layer shadows remain
    // outside this approximation. Multiple scattering is an explicit weak lobe.
    float tau=highLocalTau*highProfilePath(p,light,vec2(0,end)),T=exp(-tau);
    vec3 air=u_atmosphere?sunTransmission(u_transmittance,p,light):vec3(1);
    return air*u_highAlbedo*(phase*T+u_highMultiple*(1.-T)/(4.*PI));
}
vec3 iceIllumination(vec3 p,CloudPhases phases){
    vec3 zenith,horizon;cloudEnvironment(p,zenith,horizon);
    float sunHeight=dot(normalize(p),u_sun);
    float moonEnergy=pow(clamp(u_moonFraction,0.,1.),1.6)*u_moonGain*(1.-smoothstep(-.1,.04,sunHeight));
    vec3 result=iceDirectional(p,u_sun,phases.sun.x)*vec3(1.6,1.55,1.47);
    if(moonEnergy>.0001)result+=iceDirectional(p,u_moon,phases.moon.x)*vec3(.12,.14,.18)*moonEnergy;
    return result+mix(zenith,horizon,.35)*u_highAlbedo*.35;
}
#endif
float waterLightDepth(vec3 p,vec3 light,float rho,float footprint){
    #ifdef LAYERED_CLOUDS
    if(farCloudWeight(footprint)>=1.)return farCloudLightDepth(p,light,footprint);
    #endif
    vec3 axis=abs(light.z)>.99?vec3(0,1,0):vec3(0,0,1);
    vec3 tangent=normalize(cross(axis,light)),bitangent=cross(light,tangent);
    // Local cone transport models softened droplet self-shadow. It deliberately
    // does not pretend that five widely spaced taps can shadow an 18 km bank.
    // The integration domain is identical at every quality (kilometres).
    float nearStep=.01,end=.6,tau=rho*nearStep;
    #ifdef LAYERED_CLOUDS
    if(u_voxelReady)end=1.5;
    #endif
    for(int j=1;j<LIGHT_STEPS;j++){
        float a=float(j-1)/float(LIGHT_STEPS-1),b=float(j)/float(LIGHT_STEPS-1);
        float t0=nearStep*pow(end/nearStep,a),t1=nearStep*pow(end/nearStep,b),t=(t0+t1)*.5;
        float angle=float(j)*2.399963,radial=sqrt((float(j)+.5)/float(LIGHT_STEPS));
        vec3 cone=(tangent*cos(angle)+bitangent*sin(angle))*radial*t*.25;
        #ifdef LAYERED_CLOUDS
        // This cone is only reached by the resolved main-cloud branch. Calling
        // the dispatcher here would inline an entire statistical footprint
        // filter into every shadow tap on ANGLE, even though it cannot execute.
        float sampleDensity=lowCloudDensity(p+light*t+cone,max(footprint,t*.25),t>.1);
        #else
        float sampleDensity=cloudDensity(p+light*t+cone,max(footprint,t*.25),t>.1);
        #endif
        tau+=sampleDensity*(t1-t0);
    }
    return tau;
}
float waterScatter(vec3 phase,float tau){
    return dot(phase*vec3(1.,.5,.25),exp(-tau*vec3(1.,.5,.25)));
}
vec3 waterDirectional(vec3 p,vec3 light,vec3 phase,float rho,float footprint,float interior){
    if(planetOccludes(p,light))return vec3(0);
    vec3 transmission=u_atmosphere?sunTransmission(u_transmittance,p,light):vec3(1);
    float tau=waterLightDepth(p,light,rho,footprint);
    vec3 resolved=transmission*waterScatter(phase,tau);
    #ifdef LAYERED_CLOUDS
    if(cloudLayer==0&&farCloudWeight(footprint)>=1.){
        // Laplace transform of the locally fitted gamma depth distribution.
        // Apply each scattering order to its own optical scale; do not use
        // exp(-E[tau]) or exponentiate an already averaged transmission.
        vec3 meanTransmission=pow(vec3(1.)+tau*vec3(1.,.5,.25)/farShape,vec3(-farShape));
        resolved=transmission*dot(phase*vec3(1.,.5,.25),meanTransmission);
    }
    if(u_voxelReady&&cloudLayer==0&&farCloudWeight(footprint)<1.){
        float probability=mix(.18,1.,interior);
        float forward=smoothstep(.35,.95,dot(normalize(p-u_camera),light));
        vec3 extinction=vec3(1.,mix(.55,.32,forward*interior),mix(.28,.12,forward*interior));
        resolved=transmission*dot(phase*vec3(1.,.5*probability,.25*probability),exp(-tau*extinction));
    }
    #endif
    return resolved;
}
vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){
    #ifdef LAYERED_CLOUDS
    if(cloudLayer==1)return iceIllumination(p,phases);
    #endif
    vec3 up=normalize(p);float sunHeight=dot(up,u_sun),moonHeight=dot(up,u_moon);
    float h=clamp((length(p)-Rg-u_base)/u_thickness,0.,1.);
    #ifdef LAYERED_CLOUDS
    h=clamp((length(p)-Rg-layerBase())/layerThickness(),0.,1.);
    #endif
    vec3 light=vec3(0);float interior=0.,ambientVisibility=1.;
    float powder=mix(1.,1.-exp(-rho/16.*2.),.7);
    float baseShadow=mix(1.,mix(.15,1.,smoothstep(0.,.13,h)),.88);
    #ifdef LAYERED_CLOUDS
    powder=cloudLayer==1?1.:mix(1.,1.-exp(-rho/7.*2.),.7);
    if(cloudLayer==1)baseShadow=1.;
    if(u_voxelReady&&cloudLayer==0){
        // No voxel mip fetch in the unresolved branch. Its conditional column
        // extinction supplies the interior probability; empty area is excluded.
        interior=farCloudWeight(footprint)>=1.?farMoments.b:
            (1.-exp(-3.*voxelBodyDepth(p,footprint)))*smoothstep(.1,3.,rho);
        ambientVisibility=mix(1.,.55,interior);
        powder=1.;baseShadow=mix(.8,1.,smoothstep(0.,.15,h));
    }
    #endif
    light+=waterDirectional(p,u_sun,phases.sun,rho,footprint,interior)*vec3(1.6,1.55,1.47)*powder*baseShadow;
    // Night adaptation is deliberately separate from the displayed moon disc.
    // Phase and Earth occlusion still apply. At noon this entire light march skips.
    float moonEnergy=pow(clamp(u_moonFraction,0.,1.),1.6)*u_moonGain*
        (1.-smoothstep(-.1,.04,sunHeight));
    if(moonEnergy>.0001)
        light+=waterDirectional(p,u_moon,phases.moon,rho,footprint,interior)*vec3(.12,.14,.18)*moonEnergy*powder*baseShadow;
    // Hemispheric fill already represents diffuse/multiple-scattered sky light.
    // Two extra overhead taps used to suppress it a second time inside the cloud.
    vec3 zenith,horizon;cloudEnvironment(p,zenith,horizon);
    vec3 sky=mix(mix(zenith,horizon,.35),zenith,sqrt(h));
    light+=sky*.48*ambientVisibility;
    light+=vec3(.015,.017,.019)*max(0.,sunHeight)*(1.-h);
    // Weak diffuse night fill keeps unlit bases readable without painting them blue.
    light+=vec3(.0008,.0009,.0012)*moonEnergy*max(0.,moonHeight);
    return light;
}
