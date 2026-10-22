const float PI=3.14159265359;
const float Rg=6378.137;
const float Rt=6478.137;
uniform vec3 u_medium;
// Convert a world-depth distance to the normalized ray metric of the scaled
// WGS84 atmosphere. Omitting the directional scale loses kilometres at orbit.
float atmosphereRayDistance(vec3 worldDirection,float metres){
    return metres*.001*length(worldDirection*vec3(1,1,1.00336409));
}
vec2 sphere(vec3 p,vec3 d,float r){
    float b=dot(p,d),c=dot(p,p)-r*r,h=b*b-c;
    if(h<0.)return vec2(1e9,-1e9);
    return vec2(-b-sqrt(h),-b+sqrt(h));
}
void medium(vec3 p,out vec3 scatterR,out vec3 scatterM,out vec3 extinction){
    float h=max(0.,length(p)-Rg);
    scatterR=vec3(.005802,.013558,.0331)*exp(-h/8.)*u_medium.x;
    scatterM=vec3(.003996)*exp(-h/1.2)*u_medium.y;
    float ozone=max(0.,1.-abs(h-25.)/15.)*u_medium.z;
    extinction=scatterR+scatterM*1.111111+vec3(.00065,.001881,.000085)*ozone;
}
float phaseR(float c){return 3.*(1.+c*c)/(16.*PI);}
float phaseM(float c){float g=.8;return (1.-g*g)/(4.*PI*pow(max(.01,1.+g*g-2.*g*c),1.5));}
vec3 encodeL(vec3 v){return sqrt(max(v,vec3(0))/(1.+max(v,vec3(0))));}
vec3 decodeL(vec3 v){vec3 q=v*v;return q/max(vec3(.0001),1.-q);}
// Square-root height concentrates samples in the dense lower atmosphere.
vec2 lutUV(vec3 p,vec3 sun,vec2 size){
    float h=clamp((length(p)-Rg)/(Rt-Rg),0.,1.);
    vec2 uv=vec2(dot(normalize(p),sun)*.5+.5,sqrt(h));
    return (uv*(size-1.)+.5)/size;
}
vec3 sunTransmission(sampler2D lut,vec3 p,vec3 sun){
    if(sphere(p,sun,Rg).x>0.&&sphere(p,sun,Rg).y>0.)return vec3(0);
    return texture(lut,lutUV(p,sun,vec2(256,64))).rgb;
}
vec3 integralWeight(vec3 extinction,float ds){return (1.-exp(-extinction*ds))/max(extinction,vec3(1e-7));}
