uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D u_skyView;
uniform vec3 u_camera;
uniform mat3 u_basis;
uniform float u_exposure;
in vec2 v_textureCoordinates;
void main(){
    vec4 background=texture(colorTexture,v_textureCoordinates);
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    vec3 dirWC=mat3(czm_inverseView)*normalize(eye.xyz/eye.w);
    vec3 direction=normalize(dirWC*vec3(1,1,1.00336409));
    float depth=texture(depthTexture,v_textureCoordinates).r,maximum=1e7;
    bool surface=depth>0.&&depth<1.;
    if(surface){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=length(hit.xyz/hit.w)*.001;}
    vec3 L,T;
    if(!surface&&length(u_camera)<Rt-1.){
        vec3 local=transpose(u_basis)*direction;
        float elevation=asin(clamp(local.z,-1.,1.));
        vec2 uv=vec2(fract(atan(local.y,local.x)/(2.*PI)+1.),.5+.5*sign(elevation)*sqrt(abs(elevation)/(PI*.5)));
        L=decodeL(texture(u_skyView,(uv*vec2(191,107)+.5)/vec2(192,108)).rgb);
        T=sunTransmission(u_transmittance,u_camera,direction);
    }else integrateAtmosphere(u_camera,direction,maximum,24,L,T);
    vec3 sky=1.-exp(-L*u_exposure);
    if(!surface){
        float disk=smoothstep(cos(.0049),cos(.0045),dot(direction,u_sun));
        sky+=disk*sunTransmission(u_transmittance,u_camera,u_sun)*2.;
        // Leave stars/space visible only where atmospheric extinction is weak.
        out_FragColor=vec4(clamp(sky+background.rgb*T*.12,0.,1.),1);
    }else out_FragColor=vec4(clamp(background.rgb*T+sky,0.,1.),1);
}
