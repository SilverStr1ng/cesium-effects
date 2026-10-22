// Dual-lobe droplet scattering, integrated for both directional light sources.
float waterPhase(float c,float g){return (1.-g*g)/(4.*PI*pow(max(.015,1.+g*g-2.*g*c),1.5));}
vec3 waterPhases(float c){
    vec3 result;float eccentricity=1.;
    for(int j=0;j<3;j++){
        result[j]=mix(waterPhase(c,.76*eccentricity),waterPhase(c,-.24*eccentricity),.38);
        eccentricity*=.56;
    }
    return result;
}
CloudPhases scatteringPhases(vec3 d){
    vec3 up=normalize(u_camera),sky=vec3(.035,.05,.075),horizon=vec3(.055,.06,.07);
    if(u_atmosphere){
        vec3 p=up*(Rg+u_base+u_thickness*.35),transmission;
        vec3 tangent=u_sun-up*dot(up,u_sun);
        if(dot(tangent,tangent)<.001)tangent=cross(up,abs(up.z)>.9?vec3(1,0,0):vec3(0,0,1));
        integrateAtmosphere(p,up,150.,10,sky,transmission);
        integrateAtmosphere(p,normalize(normalize(tangent)+up*.35),250.,10,horizon,transmission);
    }else{
        float day=smoothstep(-.12,.15,dot(up,u_sun));sky*=day;horizon*=day;
    }
    return CloudPhases(waterPhases(dot(d,u_sun)),waterPhases(dot(d,u_moon)),sky,horizon);
}
float waterLightDepth(vec3 p,vec3 light,float rho,float footprint){
    float end=min(18.,max(0.,sphere(p,light,Rg+u_base+u_thickness).y));
    float tau=0.;
    // Near samples resolve local lobes; subsequent intervals cover the cloud bank.
    for(int j=0;j<LIGHT_STEPS;j++){
        float a=float(j)/float(LIGHT_STEPS),b=float(j+1)/float(LIGHT_STEPS);
        float t0=.035*(pow(1.+end/.035,a)-1.),t1=.035*(pow(1.+end/.035,b)-1.);
        float t=(t0+t1)*.5;
        float sampleDensity=cloudDensity(p+light*t,max(footprint,t*.012),false);
        tau+=sampleDensity*(t1-t0);
    }
    return tau;
}
float waterScatter(vec3 phase,float tau){
    return dot(phase*vec3(1.,.53,.28),exp(-tau*vec3(1.,.48,.23)));
}
vec3 waterDirectional(vec3 p,vec3 light,vec3 phase,float rho,float footprint){
    vec2 hit=sphere(p,light,Rg);
    if(hit.x>0.&&hit.y>0.)return vec3(0);
    vec3 transmission=u_atmosphere?sunTransmission(u_transmittance,p,light):vec3(1);
    return transmission*waterScatter(phase,waterLightDepth(p,light,rho,footprint));
}
vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){
    vec3 up=normalize(p);float sunHeight=dot(up,u_sun),moonHeight=dot(up,u_moon);
    float h=clamp((length(p)-Rg-u_base)/u_thickness,0.,1.);
    vec3 light=vec3(0);
    if(sunHeight>-.08)light+=waterDirectional(p,u_sun,phases.sun,rho,footprint)*2.4;
    // Night adaptation is deliberately separate from the displayed moon disc.
    // Phase and Earth occlusion still apply. At noon this entire light march skips.
    float moonEnergy=pow(clamp(u_moonFraction,0.,1.),1.6)*u_moonGain*
        (1.-smoothstep(-.1,.04,sunHeight));
    if(moonHeight>-.03&&moonEnergy>.0001)
        light+=waterDirectional(p,u_moon,phases.moon,rho,footprint)*vec3(.15,.18,.23)*moonEnergy;
    float overhead=cloudDensity(p+up*.3,footprint,true)*.3+cloudDensity(p+up*1.1,max(.08,footprint),true)*.7;
    vec3 sky=mix(phases.horizon,phases.sky,.6+.4*sqrt(h));
    light+=sky*(.22+.78*exp(-overhead*.35))*.8;
    light+=vec3(.015,.017,.019)*max(0.,sunHeight)*(1.-h);
    // Weak diffuse night fill keeps unlit bases readable without painting them blue.
    light+=vec3(.0012,.0015,.0022)*moonEnergy*max(0.,moonHeight)*exp(-overhead*.2);
    return light*.93;
}
