in vec2 v_textureCoordinates;
void main(){
    vec2 pixel=gl_FragCoord.xy-.5;
    vec2 tile=floor(pixel/vec2(64,32));
    float layer=tile.x+tile.y*4.;
    vec2 uv=mod(pixel,vec2(64,32))/vec2(63,31);
    float lon=(uv.x-.5)*2.*PI,lat=(uv.y-.5)*PI;
    vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
    vec3 p=n*(Rg+u_base+u_thickness*layer/15.);
    float tau=0.,t=1.5,ambient=0.;
    for(int i=0;i<7;i++){
        float ds=.45*pow(1.65,float(i));
        tau+=cloudDensity(p+u_sun*(t+ds*.5),5.,true)*ds;
        t+=ds;
    }
    for(int i=0;i<4;i++)ambient+=cloudDensity(p+n*((float(i)+.5)*u_thickness*.25),5.,true)*u_thickness*.25;
    out_FragColor=vec4(min(tau/16.,1.),exp(-ambient*.4),0,1);
}
