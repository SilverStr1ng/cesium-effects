uniform vec3 u_camera;
uniform mat3 u_basis;
in vec2 v_textureCoordinates;
void main(){
    vec2 uv=(gl_FragCoord.xy-.5)/vec2(191,107);
    float angle=uv.x*2.*PI,vertical=uv.y*2.-1.;
    float elevation=sign(vertical)*vertical*vertical*PI*.5;
    vec3 d=u_basis*vec3(cos(elevation)*cos(angle),cos(elevation)*sin(angle),sin(elevation));
    vec3 L,T;integrateAtmosphere(u_camera,d,1e6,32,L,T);
    out_FragColor=vec4(encodeL(L),1);
}
