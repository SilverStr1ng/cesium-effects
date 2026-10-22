float hg(float c,float g){return (1.-g*g)/pow(max(.01,1.+g*g-2.*g*c),1.5);}
float opticalDepthToSun(vec3 p,float footprint){
    float end=min(32.,max(0.,sphere(p,u_sun,Rg+u_base+u_thickness).y)),tau=0.;
    // Expand the sample cone with distance, integrating the same density field
    // that the camera sees. A 600 km global atlas cannot shadow 1 km cloud lobes.
    vec3 side=normalize(cross(u_sun,abs(u_sun.z)>.9?vec3(1,0,0):vec3(0,0,1))),up=cross(u_sun,side);
    for(int j=0;j<LIGHT_STEPS;j++){
        float a=float(j)/float(LIGHT_STEPS),b=float(j+1)/float(LIGHT_STEPS);
        // Geometric spacing concentrates taps near cloud edges.
        float range=1.+end/.06;
        float t0=.06*(pow(range,a)-1.),t1=.06*(pow(range,b)-1.),t=(t0+t1)*.5,angle=float(j)*2.39996;
        vec3 offset=(side*cos(angle)+up*sin(angle))*t*.025;
        tau+=cloudDensity(p+u_sun*t+offset,max(footprint,t*.02),false)*(t1-t0);
    }
    return tau;
}
CloudPhases scatteringPhases(vec3 d){
    float c=dot(d,u_sun);vec3 phases;
    float weight=1.,extinction=1.,g=.72;
    for(int order=0;order<3;order++){
        phases[order]=weight*(.85*hg(c,g)+.15*hg(c,-.18*extinction))/(4.*PI);
        weight*=.42;extinction*=.52;g*=.55;
    }
    return CloudPhases(phases,vec3(0),vec3(0),vec3(0));
}
vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){
    vec3 vertical=normalize(p);float mu=dot(vertical,u_sun);
    float tau=opticalDepthToSun(p,footprint);
    vec2 ground=sphere(p,u_sun,Rg);
    vec3 solar=vec3(1.);
    if(u_atmosphere)solar=sunTransmission(u_transmittance,p,u_sun);
    if(ground.x>0.&&ground.y>0.)solar=vec3(0);
    // Successive scattering orders broaden the phase and travel farther.
    // All orders retain optical-depth attenuation instead of a constant white fill.
    float direct=dot(phases.sun,exp(-tau*vec3(1.,.52,.2704)));
    float overhead=(cloudDensity(p+vertical*.12,footprint,false)*.24+cloudDensity(p+vertical*.65,max(footprint,.08),false)*1.05);
    vec3 ambient=vec3(.012,.018,.028)*smoothstep(-.18,.12,mu);
    if(u_atmosphere)ambient=decodeL(texture(u_multiple,lutUV(p,u_sun,vec2(32))).rgb)*2.;
    ambient*=exp(-overhead*.65)*.8+.2;
    float height=clamp((length(p)-Rg-u_base)/u_thickness,0.,1.);
    vec3 bounce=solar*max(0.,mu)*.025*(1.-height)*(.3+.7*exp(-rho*.12));
    float moon=max(0.,dot(vertical,u_moon))*u_moonFraction*(1.-smoothstep(-.1,.05,mu));
    return solar*direct*3.+ambient+bounce+vec3(.0004,.0006,.001)*moon;
}
