uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D u_skyView;
uniform vec3 u_camera;
uniform mat3 u_basis;
uniform float u_exposure;
uniform float u_sunRadius;
uniform vec3 u_moon;
uniform float u_moonRadius;
uniform float u_moonBrightness;
in vec2 v_textureCoordinates;
void main(){
    vec4 background=texture(colorTexture,v_textureCoordinates);
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    // Do not divide by w: at an effectively infinite far plane it may round to zero.
    vec3 dirWC=mat3(czm_inverseView)*normalize(eye.xyz);
    vec3 scaledDirection=dirWC*vec3(1,1,1.00336409),direction=normalize(scaledDirection);
    float depth=texture(depthTexture,v_textureCoordinates).r,maximum=1e7;
    bool surface=depth>0.&&depth<1.;
    // Camera/rays use the ellipsoid-scaled atmosphere sphere. The world-space
    // depth must use that same ray metric; at orbit the omitted factor truncates
    // tens of kilometres of air and reveals the globe's tile tessellation.
    if(surface){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=atmosphereRayDistance(dirWC,length(hit.xyz/hit.w));}
    vec3 L,T;
    if(!surface&&length(u_camera)<Rt-1.){
        vec3 local=transpose(u_basis)*direction;
        float elevation=asin(clamp(local.z,-1.,1.));
        vec2 uv=vec2(fract(atan(local.y,local.x)/(2.*PI)+1.),.5+.5*sign(elevation)*sqrt(abs(elevation)/(PI*.5)));
        L=decodeL(texture(u_skyView,(uv*vec2(191,107)+.5)/vec2(192,108)).rgb);
        T=sunTransmission(u_transmittance,u_camera,direction);
    }else integrateAtmosphere(u_camera,direction,maximum,24,L,T);
    vec3 sky=L;
    if(!surface){
        float angle=acos(clamp(dot(direction,u_sun),-1.,1.));
        float disk=1.-smoothstep(u_sunRadius*.96,u_sunRadius*1.04,angle);
        float halo=exp(-angle/max(.001,u_sunRadius)*.75)*.32;
        sky+=(disk*8.+halo*.12)*sunTransmission(u_transmittance,u_camera,u_sun)*vec3(1.,.94,.83);
        // A lit sphere projected onto the Moon's apparent disc gives the lunar phase.
        float moonCos=dot(direction,u_moon);
        if(moonCos>cos(u_moonRadius*1.05)){
            vec3 right=normalize(cross(abs(u_moon.z)>.99?vec3(0,1,0):vec3(0,0,1),u_moon));
            vec3 up=cross(u_moon,right);
            vec2 uv=vec2(dot(direction,right),dot(direction,up))/sin(u_moonRadius);
            float rr=dot(uv,uv);
            vec3 normal=right*uv.x+up*uv.y-u_moon*sqrt(max(0.,1.-rr));
            float lit=max(0.,dot(normal,u_sun));
            float maria=.82+.08*sin(uv.x*17.+sin(uv.y*23.))+.06*sin(uv.y*29.+uv.x*11.);
            // Display adaptation is applied to lunar radiance as well as the sky.
            // Preserve the terminator/phase, with only a small earthshine floor.
            vec3 moonRadiance=vec3(.91,.94,1.)*(.0006+lit*.06)*maria*sunTransmission(u_transmittance,u_camera,direction);
            vec3 moon=moonRadiance*u_moonBrightness;
            sky=mix(sky,sky+moon,1.-smoothstep(.94,1.04,rr));
        }
        // Leave stars/space visible only where atmospheric extinction is weak.
        float night=1.-smoothstep(-.15,.05,dot(normalize(u_camera),u_sun));
        sky+=recoverRadiance(background.rgb,u_exposure)*T*mix(.005,.75,night);
    }else sky+=recoverRadiance(background.rgb,u_exposure)*T;
    out_FragColor=vec4(displayRadiance(sky,u_exposure),1);
}
