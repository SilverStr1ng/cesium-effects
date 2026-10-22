uniform sampler2D u_transmittance;
uniform sampler2D u_multiple;
uniform vec3 u_sun;
void integrateAtmosphere(vec3 origin,vec3 direction,float maximum,int steps,out vec3 L,out vec3 T){
    L=vec3(0);T=vec3(1);
    vec2 air=sphere(origin,direction,Rt);
    float start=max(0.,air.x),end=min(maximum,air.y);
    vec2 ground=sphere(origin,direction,Rg);
    if(ground.x>0.)end=min(end,ground.x);
    if(end<=start)return;
    float c=dot(direction,u_sun),pr=phaseR(c),pm=phaseM(c);
    for(int i=0;i<40;i++){
        if(i>=steps)break;
        // Quadratic distances retain detail close to the observer.
        float a=float(i)/float(steps),b=float(i+1)/float(steps);
        float t0=mix(start,end,a*a),t1=mix(start,end,b*b),ds=t1-t0;
        vec3 p=origin+direction*(t0+t1)*.5,r,m,e;medium(p,r,m,e);
        vec3 direct=sunTransmission(u_transmittance,p,u_sun)*(r*pr+m*pm);
        vec3 multi=decodeL(texture(u_multiple,lutUV(p,u_sun,vec2(32))).rgb)*(r+m);
        L+=T*(direct+multi)*integralWeight(e,ds);
        T*=exp(-e*ds);
    }
}
