uniform sampler2D depthTexture;
uniform sampler2D u_lightCache;
uniform sampler2D u_transmittance;
uniform bool u_atmosphere;
uniform vec3 u_camera,u_moon;
uniform float u_pixelAngle,u_moonFraction;
in vec2 v_textureCoordinates;
float sceneDepth(vec2 uv){
    // A reduced-resolution ray rarely hits the exact centre of a full-resolution
    // depth texel. Nearest depth at a different ray cuts holes in orbital clouds.
    vec2 size=vec2(textureSize(depthTexture,0)),pixel=uv*size-.5,base=floor(pixel),f=fract(pixel);
    vec4 z=vec4(texture(depthTexture,(base+vec2(.5,.5))/size).r,
        texture(depthTexture,(base+vec2(1.5,.5))/size).r,
        texture(depthTexture,(base+vec2(.5,1.5))/size).r,
        texture(depthTexture,(base+vec2(1.5,1.5))/size).r);
    float lo=min(min(z.x,z.y),min(z.z,z.w)),hi=max(max(z.x,z.y),max(z.z,z.w));
    if(lo<=0.||hi>=1.||hi-lo>.002)return texture(depthTexture,uv).r;
    return mix(mix(z.x,z.y,f.x),mix(z.z,z.w,f.x),f.y);
}
vec2 cacheLayer(vec2 uv,float layer){
    vec2 tile=vec2(mod(layer,4.),floor(layer/4.));
    return (tile*vec2(64,32)+uv*vec2(63,31)+.5)/vec2(256,128);
}
vec2 cachedLight(vec3 p){
    vec2 uv=weatherUV(p);float h=clamp((length(p)-Rg-u_base)/u_thickness*15.,0.,15.);
    return mix(texture(u_lightCache,cacheLayer(uv,floor(h))).rg,texture(u_lightCache,cacheLayer(uv,min(15.,floor(h)+1.))).rg,fract(h));
}
float hg(float c,float g){return (1.-g*g)/pow(max(.01,1.+g*g-2.*g*c),1.5);}
vec3 illumination(vec3 p,vec3 d,float rho,float footprint){
    vec2 cached=cachedLight(p);
    float tau=cached.r*16.;
    tau+=cloudDensity(p+u_sun*.35,footprint,false)*.7+cloudDensity(p+u_sun*1.1,footprint,false)*.8;
    float mu=dot(normalize(p),u_sun),phase=.8*hg(dot(d,u_sun),.65)+.2*hg(dot(d,u_sun),-.25);
    vec2 ground=sphere(p,u_sun,Rg);
    vec3 solar=vec3(1.);
    if(u_atmosphere){vec2 uv=vec2(mu*.5+.5,sqrt(clamp((length(p)-Rg)/100.,0.,1.)));solar=texture(u_transmittance,(uv*vec2(255,63)+.5)/vec2(256,64)).rgb;}
    if(ground.x>0.&&ground.y>0.)solar=vec3(0);
    float direct=exp(-tau)*phase*.65+exp(-tau*.35)*.35;
    float inner=(1.-exp(-rho*3.))*exp(-tau*.18)*.45;
    vec3 ambient=vec3(.32,.43,.62)*(.25+.75*cached.g)*smoothstep(-.18,.12,mu);
    float moon=max(0.,dot(normalize(p),u_moon))*u_moonFraction;
    return solar*(direct+inner)*1.4+ambient+vec3(.006,.009,.018)+vec3(.025,.033,.055)*moon;
}
void integrateCloud(vec3 d,vec2 segment,inout vec4 acc){
    if(segment.y<=segment.x)return;
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float span=segment.y-segment.x;
    // Quadratic distribution preserves nearby detail on long horizon rays.
    float curve=1.-smoothstep(10.,250.,segment.x);
    for(int i=0;i<CLOUD_STEPS;i++){
        float a=float(i)/float(CLOUD_STEPS),b=float(i+1)/float(CLOUD_STEPS);
        float t0=segment.x+mix(a,a*a,curve)*span,t1=segment.x+mix(b,b*b,curve)*span;
        float t=mix(t0,t1,.2+jitter*.6),ds=t1-t0;
        vec3 p=u_camera+d*t;float footprint=max(.002,t*u_pixelAngle);
        float rho=cloudDensity(p,footprint,false);
        if(rho>.001){
            float alpha=1.-exp(-rho*ds);
            vec3 light=illumination(p,d,rho,footprint);
            vec3 color=1.-exp(-light*1.25);
            // Only the lower-atmosphere portion contributes to distant cloud haze.
            float haze=(1.-exp(-t*.008))*exp(-max(0.,length(u_camera)-Rg-8.)/20.)*.75;
            float day=smoothstep(-.15,.1,dot(normalize(p),u_sun));
            color=mix(color,vec3(.32,.46,.65)*day,haze);
            acc.rgb+=(1.-acc.a)*alpha*color;acc.a+=(1.-acc.a)*alpha;
            if(acc.a>.995)break;
        }
    }
}
void main(){
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    vec3 wc=mat3(czm_inverseView)*normalize(eye.xyz),scaled=wc*vec3(1,1,1.00336409),d=normalize(scaled);
    float maximum=1e8,depth=sceneDepth(v_textureCoordinates);
    if(depth>0.&&depth<1.){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=length(hit.xyz/hit.w)*.001*length(scaled);}
    vec2 ground=sphere(u_camera,d,Rg);if(ground.x>0.)maximum=min(maximum,ground.x);
    vec2 outer=sphere(u_camera,d,Rg+u_base+u_thickness);outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    vec4 acc=vec4(0);
    if(outer.y>outer.x){
        vec2 inner=sphere(u_camera,d,Rg+u_base);
        if(inner.y<=outer.x||inner.x>=outer.y)integrateCloud(d,outer,acc);
        else{integrateCloud(d,vec2(outer.x,min(outer.y,inner.x)),acc);if(acc.a<.995)integrateCloud(d,vec2(max(outer.x,inner.y),outer.y),acc);}
    }
    out_FragColor=acc;
}
