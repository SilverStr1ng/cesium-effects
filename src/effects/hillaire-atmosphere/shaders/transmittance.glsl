in vec2 v_textureCoordinates;
void main(){
    vec2 uv=(gl_FragCoord.xy-.5)/vec2(255,63);
    vec3 p=vec3(0,0,Rg+max(.001,uv.y*uv.y*(Rt-Rg)));
    float mu=uv.x*2.-1.;vec3 d=vec3(sqrt(max(0.,1.-mu*mu)),0,mu);
    vec2 ground=sphere(p,d,Rg);
    if(ground.x>0.&&ground.y>0.){out_FragColor=vec4(0,0,0,1);return;}
    float ds=max(0.,sphere(p,d,Rt).y)/64.;vec3 tau=vec3(0);
    for(int i=0;i<64;i++){vec3 r,m,e;medium(p+d*(float(i)+.5)*ds,r,m,e);tau+=e*ds;}
    out_FragColor=vec4(exp(-tau),1);
}
