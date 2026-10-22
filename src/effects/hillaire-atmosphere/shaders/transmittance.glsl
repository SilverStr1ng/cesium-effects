in vec2 v_textureCoordinates;
void main(){
    vec2 uv=(gl_FragCoord.xy-.5)/vec2(255,63);
    vec3 p,d;transmissionRay(uv,p,d);
    float ds=max(0.,sphere(p,d,Rt).y)/64.;vec3 tau=vec3(0);
    for(int i=0;i<64;i++){vec3 r,m,e;medium(p+d*(float(i)+.5)*ds,r,m,e);tau+=e*ds;}
    out_FragColor=vec4(exp(-tau),1);
}
