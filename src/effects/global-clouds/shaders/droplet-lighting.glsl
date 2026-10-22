// Dual-lobe droplet scattering, integrated for both directional light sources.
float waterPhase(float c,float g){return (1.-g*g)/(4.*PI*pow(max(.015,1.+g*g-2.*g*c),1.5));}
vec3 waterPhases(float c){
    vec3 result;float eccentricity=1.;
    for(int j=0;j<3;j++){
        result[j]=mix(waterPhase(c,.8*eccentricity),waterPhase(c,-.2*eccentricity),.5);
        eccentricity*=.5;
    }
    return result;
}
void cloudEnvironment(vec3 p,out vec3 sky,out vec3 horizon){
    vec3 up=normalize(p);sky=vec3(.035,.05,.075);horizon=vec3(.055,.06,.07);
    if(u_atmosphere){
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
    vec3 sky=vec3(0),horizon=vec3(0);
    #ifndef LAYERED_CLOUDS
    cloudEnvironment(normalize(u_camera)*(Rg+u_base+u_thickness*.35),sky,horizon);
    #endif
    return CloudPhases(waterPhases(dot(d,u_sun)),waterPhases(dot(d,u_moon)),sky,horizon);
}
float waterLightDepth(vec3 p,vec3 light,float rho,float footprint){
    #ifdef LAYERED_CLOUDS
    // Thin ice uses a bounded local column approximation, avoiding another cone
    // march per high-cloud step. This does not model shadows between layers.
    if(cloudLayer==1){
        float h=clamp((length(p)-Rg-u_highBase)/u_highThickness,0.,1.);
        float mu=dot(normalize(p),light);
        return rho*min(8.,u_highThickness*(mu>0.?1.-h:h)/max(.08,abs(mu)))*.5;
    }
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
        float sampleDensity=cloudDensity(p+light*t+cone,max(footprint,t*.25),t>.1);
        tau+=sampleDensity*(t1-t0);
    }
    #ifdef LAYERED_CLOUDS
    float far=farCloudWeight(footprint);
    if(far>0.)tau=mix(tau,farCloudLightDepth(p,light,footprint),far);
    #endif
    return tau;
}
float waterScatter(vec3 phase,float tau){
    return dot(phase*vec3(1.,.5,.25),exp(-tau*vec3(1.,.5,.25)));
}
vec3 waterDirectional(vec3 p,vec3 light,vec3 phase,float rho,float footprint,float interior){
    vec2 hit=sphere(p,light,Rg);
    if(hit.x>0.&&hit.y>0.)return vec3(0);
    vec3 transmission=u_atmosphere?sunTransmission(u_transmittance,p,light):vec3(1);
    float tau=waterLightDepth(p,light,rho,footprint);
    vec3 resolved=transmission*waterScatter(phase,tau);
    #ifdef LAYERED_CLOUDS
    if(u_voxelReady&&cloudLayer==0&&farCloudWeight(footprint)<1.){
        float probability=mix(.18,1.,interior);
        float forward=smoothstep(.35,.95,dot(normalize(p-u_camera),light));
        vec3 extinction=vec3(1.,mix(.55,.32,forward*interior),mix(.28,.12,forward*interior));
        resolved=transmission*dot(phase*vec3(1.,.5*probability,.25*probability),exp(-tau*extinction));
    }
    float far=cloudLayer==0?farCloudWeight(footprint):0.;
    if(far>0.){
        // Unresolved opaque columns keep their conditional multiple scattering.
        // Applying their mean shadow to a dilute effective medium darkens them
        // twice. The table's bounded two-flux reflectance supplies a local,
        // sun-dependent source; the original directional lobe handles thin light.
        float reflectance=columnOptics(cloudWeather(p,footprint),1.).z;
        float above=smoothstep(-.1,.1,dot(normalize(u_camera-p),normalize(p)));
        float diffuse=mix(1.-reflectance,reflectance,above)*max(0.,dot(normalize(p),light))/PI;
        vec3 statistical=transmission*(diffuse+waterScatter(phase,tau)*(1.-reflectance));
        return mix(resolved,statistical,far);
    }
    #endif
    return resolved;
}
vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){
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
        interior=(1.-exp(-3.*voxelBodyDepth(p,footprint)))*smoothstep(.1,3.,rho);
        ambientVisibility=mix(1.,.55,interior);
        powder=1.;baseShadow=mix(.8,1.,smoothstep(0.,.15,h));
    }
    #endif
    if(sunHeight>-.08)light+=waterDirectional(p,u_sun,phases.sun,rho,footprint,interior)*vec3(1.6,1.55,1.47)*powder*baseShadow;
    // Night adaptation is deliberately separate from the displayed moon disc.
    // Phase and Earth occlusion still apply. At noon this entire light march skips.
    float moonEnergy=pow(clamp(u_moonFraction,0.,1.),1.6)*u_moonGain*
        (1.-smoothstep(-.1,.04,sunHeight));
    if(moonHeight>-.03&&moonEnergy>.0001)
        light+=waterDirectional(p,u_moon,phases.moon,rho,footprint,interior)*vec3(.12,.14,.18)*moonEnergy*powder*baseShadow;
    // Hemispheric fill already represents diffuse/multiple-scattered sky light.
    // Two extra overhead taps used to suppress it a second time inside the cloud.
    vec3 sky=mix(mix(phases.sky,phases.horizon,.35),phases.sky,sqrt(h));
    light+=sky*.48*ambientVisibility;
    light+=vec3(.015,.017,.019)*max(0.,sunHeight)*(1.-h);
    // Weak diffuse night fill keeps unlit bases readable without painting them blue.
    light+=vec3(.0008,.0009,.0012)*moonEnergy*max(0.,moonHeight);
    return light;
}
