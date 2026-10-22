uniform sampler2D u_transmittance;
uniform sampler2D u_multiple;
uniform vec3 u_sun;
#ifndef ATMOSPHERE_MAX_STEPS
#define ATMOSPHERE_MAX_STEPS 40
#endif
void integrateAtmosphereWithSun(vec3 origin,vec3 direction,float maximum,int steps,vec3 sun,out vec3 L,out vec3 T){
    L=vec3(0);T=vec3(1);
    vec2 path=atmosphereInterval(origin,direction,maximum);
    float start=path.x,end=path.y;
    if(end<=start)return;
    float c=dot(direction,sun),pr=phaseR(c),pm=phaseM(c);
    float closest=clamp(-dot(origin,direction),start,end);
    vec2 root=vec2(-sqrt(closest-start),sqrt(end-closest));
    for(int i=0;i<ATMOSPHERE_MAX_STEPS;i++){
        if(i>=steps)break;
        // Concentrate the SAME step budget at the densest part of the ray.
        // Near the ground this reduces to the previous quadratic distribution;
        // from space the important samples are at the limb/ground, not camera.
        float a=float(i)/float(steps),b=float(i+1)/float(steps);
        float qa=mix(root.x,root.y,a),qb=mix(root.x,root.y,b);
        float t0=closest+qa*abs(qa),t1=closest+qb*abs(qb),ds=t1-t0;
        vec3 p=origin+direction*(t0+t1)*.5,r,m,e;medium(p,r,m,e);
        vec3 direct=sunTransmission(u_transmittance,p,sun)*(r*pr+m*pm);
        vec3 multi=decodeL(texture(u_multiple,lutUV(p,sun,vec2(32))).rgb)*(r+m);
        L+=T*(direct+multi)*integralWeight(e,ds);
        T*=exp(-e*ds);
    }
}
void integrateAtmosphere(vec3 origin,vec3 direction,float maximum,int steps,out vec3 L,out vec3 T){
    integrateAtmosphereWithSun(origin,direction,maximum,steps,u_sun,L,T);
}
