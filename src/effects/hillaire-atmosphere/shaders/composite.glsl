uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform bool u_emptySceneDepth;
uniform sampler2D u_skyView;
uniform vec3 u_camera;
uniform mat3 u_basis;
uniform float u_exposure;
uniform float u_sunRadius;
uniform float u_sunBrightness,u_sunHaloRadius,u_sunHaloBrightness;
uniform float u_moonHaloRadius,u_moonHaloBrightness;
uniform vec3 u_sunDisc,u_moonDisc,u_moonSun;
uniform float u_moonRadius;
uniform float u_moonBrightness;
uniform sampler2D u_moonAlbedo;
uniform float u_moonAlbedoMean;
uniform mat3 u_moonFixedFromEcef;
in vec2 v_textureCoordinates;
void main(){
    vec4 background=texture(colorTexture,v_textureCoordinates);
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    // Do not divide by w: at an effectively infinite far plane it may round to zero.
    vec3 dirWC=mat3(czm_inverseView)*normalize(eye.xyz);
    vec3 scaledDirection=dirWC*vec3(1,1,1.00336409),direction=normalize(scaledDirection);
    float depth=u_emptySceneDepth?1.:texture(depthTexture,v_textureCoordinates).r,maximum=1e7;
    bool surface=depth>0.&&depth<1.;
    // Camera/rays use the ellipsoid-scaled atmosphere sphere. The world-space
    // depth must use that same ray metric; at orbit the omitted factor truncates
    // tens of kilometres of air and reveals the globe's tile tessellation.
    if(surface){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=atmosphereRayDistance(dirWC,length(hit.xyz/hit.w));}
    vec3 L,T;
    float radius=length(u_camera);
    if(!surface&&radius<Rt){
        vec3 local=transpose(u_basis)*direction;
        L=decodeL(texture(u_skyView,skyViewTextureUV(local,radius)).rgb);
        // The finite LUT and direct quadrature have different errors. Fade to
        // the space path before exiting, so its boundary is actually continuous.
        float spaceBlend=smoothstep(Rt-5.,Rt,radius);
        if(spaceBlend>0.){
            vec3 rayL,rayT;integrateAtmosphere(u_camera,direction,maximum,24,rayL,rayT);
            L=mix(L,rayL,spaceBlend);
        }
    }else integrateAtmosphere(u_camera,direction,maximum,24,L,T);
    if(!surface)T=sunTransmission(u_transmittance,u_camera,direction);
    vec3 sky=L;
    if(!surface){
        // Space is behind both discs. The Moon's dark hemisphere must occult
        // stars and the solar halo, rather than being an additive transparent disc.
        float night=1.-smoothstep(-.15,.05,dot(normalize(u_camera),u_sun));
        sky+=recoverRadiance(background.rgb,u_exposure)*T*mix(.005,.75,night);
        float angle=atan(length(cross(dirWC,u_sunDisc)),dot(dirWC,u_sunDisc));
        float pixel=max(length(dFdx(dirWC)),length(dFdy(dirWC)));
        float edge=max(pixel*.65,u_sunRadius*.015);
        float disk=1.-smoothstep(u_sunRadius-edge,u_sunRadius+edge,angle);
        // Disc, artistic halo and brightness have separate display controls.
        // T belongs to THIS pixel's ray: an enlarged solar disc can straddle the
        // real horizon even when its centre is below it. No centre-ray shortcut.
        float halo=exp(-angle/max(.001,u_sunHaloRadius)*.75)*.0384*u_sunHaloBrightness;
        sky+=(disk*8.*u_sunBrightness+halo)*T*vec3(1.,.94,.83);
        // A lit sphere projected onto the Moon's apparent disc gives the lunar phase.
        float moonAngle=atan(length(cross(dirWC,u_moonDisc)),dot(dirWC,u_moonDisc));
        float moonEdge=max(pixel*.65,u_moonRadius*.015);
        float phase=clamp((1.-dot(u_moonDisc,u_moonSun))*.5,0.,1.);
        // Optional artistic glow (off by default), not physical lunar scattering.
        sky+=exp(-moonAngle/max(.001,u_moonHaloRadius)*.75)*.0003*u_moonHaloBrightness*phase*T;
        if(moonAngle<u_moonRadius+moonEdge){
            vec3 right=normalize(cross(abs(u_moonDisc.z)>.99?vec3(0,1,0):vec3(0,0,1),u_moonDisc));
            vec3 up=cross(u_moonDisc,right);
            vec2 uv=vec2(dot(dirWC,right),dot(dirWC,up))/sin(u_moonRadius);
            float rr=dot(uv,uv);
            float mu=sqrt(max(0.,1.-rr));
            vec3 normal=right*uv.x+up*uv.y-u_moonDisc*mu;
            float lit=max(0.,dot(normal,u_moonSun));
            vec3 lunar=u_moonFixedFromEcef*normalize(normal);
            vec2 mapUV=vec2(.5+atan(lunar.y,lunar.x)/(2.*PI),.5-asin(clamp(lunar.z,-1.,1.))/PI);
            // Explicit analytic footprint: branch boundaries cannot supply valid
            // implicit derivatives. Increase mip toward limb and map poles.
            float mapFootprint=float(textureSize(u_moonAlbedo,0).x)*pixel/
                (2.*PI*sin(u_moonRadius)*max(.05,mu)*max(.05,length(lunar.xy)));
            vec3 albedo=textureLod(u_moonAlbedo,mapUV,max(0.,log2(mapFootprint))).rgb*(.82/max(.001,u_moonAlbedoMean));
            // Display adaptation is applied to lunar radiance as well as the sky.
            // Preserve the terminator/phase, with only a small earthshine floor.
            // Lunar regolith is closer to Lommel-Seeliger than a Lambert sphere:
            // keep the full-moon limb readable while preserving the terminator.
            float regolith=.75*(2.*lit/max(.02,lit+mu))+.25*lit;
            float earthshine=.0006*(1.-phase);
            vec3 moonRadiance=(earthshine+regolith*.06)*albedo*T;
            vec3 moon=moonRadiance*u_moonBrightness;
            sky=mix(sky,L+moon,1.-smoothstep(u_moonRadius-moonEdge,u_moonRadius+moonEdge,moonAngle));
        }
    }else sky+=recoverRadiance(background.rgb,u_exposure)*T;
    // This is scene-linear radiance, before clouds or any display clipping.
    // A float attachment preserves highlights directly; RGBA8 remains portable.
    #ifdef SKY_HDR
    out_FragColor=vec4(sky,1);
    #else
    // A stable, zero-mean sub-byte dither prevents the additional encode target
    // from quantizing the continuous halo into rings. It changes neither the
    // exposure nor the mean encoded signal and does not require temporal history.
    float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
    out_FragColor=vec4(encodeL(sky)+dither/255.,1);
    #endif
}
