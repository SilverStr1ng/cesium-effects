uniform vec3 u_camera;
uniform mat3 u_basis;
in vec2 v_textureCoordinates;
void main(){
    vec2 uv=(gl_FragCoord.xy-.5)/vec2(191,107);
    vec3 d=u_basis*skyViewDirection(uv,length(u_camera));
    vec3 L,T;integrateAtmosphere(u_camera,d,1e6,32,L,T);
    out_FragColor=vec4(encodeL(L),1);
}
