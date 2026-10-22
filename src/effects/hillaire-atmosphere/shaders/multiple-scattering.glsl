uniform sampler2D u_transmittance;
in vec2 v_textureCoordinates;
void main(){
    vec2 uv=(gl_FragCoord.xy-.5)/31.;
    vec3 p=vec3(0,0,Rg+max(.01,uv.y*uv.y*100.));
    float mu=uv.x*2.-1.;vec3 sun=vec3(sqrt(max(0.,1.-mu*mu)),0,mu);
    vec3 luminance=vec3(0),feedback=vec3(0);
    // Uniform Fibonacci sphere quadrature and isotropic higher-order closure.
    for(int j=0;j<24;j++){
        float z=1.-2.*(float(j)+.5)/24.,a=float(j)*2.39996323;
        vec3 d=vec3(cos(a)*sqrt(1.-z*z),sin(a)*sqrt(1.-z*z),z);
        float end=sphere(p,d,Rt).y;vec2 ground=sphere(p,d,Rg);
        bool hit=ground.x>0.&&ground.x<end;if(hit)end=ground.x;
        float ds=end/24.;vec3 T=vec3(1);
        for(int i=0;i<24;i++){
            vec3 q=p+d*(float(i)+.5)*ds,r,m,e;medium(q,r,m,e);
            vec3 weight=T*integralWeight(e,ds);
            luminance+=weight*(r+m)*sunTransmission(u_transmittance,q,sun)/(4.*PI);
            feedback+=weight*(r+m);
            T*=exp(-e*ds);
        }
        if(hit){vec3 q=p+d*(end-.01);luminance+=T*.15/PI*max(0.,dot(normalize(q),sun))*sunTransmission(u_transmittance,q,sun);}
    }
    vec3 multi=(luminance/24.)/max(vec3(.05),1.-feedback/24.);
    out_FragColor=vec4(encodeL(multi),1);
}
