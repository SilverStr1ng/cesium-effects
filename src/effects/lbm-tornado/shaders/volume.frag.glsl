uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D u_density;
uniform mat4 u_viewToLocal;
uniform vec3 u_dimensions;
uniform vec3 u_grid;
uniform vec2 u_tiles;
uniform float u_time;
uniform float u_opacity;
uniform float u_swirl;
uniform float u_updraft;
uniform float u_turbulence;
uniform float u_steps;
in vec2 v_textureCoordinates;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(.13,.37,.73));
    p *= 17.;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float noise(vec3 p) {
    vec3 i=floor(p), f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise(p)*.57+noise(p*2.03+11.2)*.28+noise(p*4.07-7.1)*.15; }
float slice(vec2 xy, float z) {
    vec2 tile=vec2(mod(z,u_tiles.x),floor(z/u_tiles.x));
    vec2 uv=(tile*u_grid.xy + .5 + xy*(u_grid.xy-1.))/(u_tiles*u_grid.xy);
    return texture(u_density,uv).r;
}
float field(vec3 p) {
    if(any(lessThan(p,vec3(0))) || any(greaterThan(p,vec3(1)))) return 0.;
    float z=p.z*(u_grid.z-1.);
    return mix(slice(p.xy,floor(z)),slice(p.xy,min(floor(z)+1.,u_grid.z-1.)),fract(z));
}
float smoke(vec3 p) {
    float base=field(p);
    if(base<.008) return 0.;
    vec2 radial=(p.xy-.5)*2.;
    float angle=atan(radial.y,radial.x) - u_time*.7*u_swirl/(.4+length(radial)*3.) + p.z*10.;
    vec3 flow=vec3(cos(angle)*length(radial),sin(angle)*length(radial),p.z-u_time*.065*u_updraft);
    float billows=fbm(flow*vec3(9.,9.,14.));
    vec3 warp=vec3(noise(flow*7.+4.3),noise(flow*7.-3.7),noise(flow*5.+17.));
    vec3 displaced=p+(warp-.5)*vec3(.075,.075,.1)*(.35+u_turbulence);
    base=field(displaced);
    float eroded=max(0.,base-(1.-billows)*.32);
    float detail=mix(.85,smoothstep(.15,.8,billows)*1.8,.55+.35*u_turbulence);
    return eroded*detail*u_opacity*1.3;
}

void main() {
    vec4 background=texture(colorTexture,v_textureCoordinates);
    vec4 rayEC=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1.,1.);
    vec3 directionEC=normalize(rayEC.xyz/rayEC.w);
    vec3 origin=u_viewToLocal[3].xyz;
    vec3 direction=normalize(mat3(u_viewToLocal)*directionEC);
    vec3 lower=vec3(-u_dimensions.xy*.5,0.);
    vec3 upper=vec3(u_dimensions.xy*.5,u_dimensions.z);
    vec3 safeDirection=mix(vec3(1e-7),direction,greaterThan(abs(direction),vec3(1e-7)));
    vec3 a=(lower-origin)/safeDirection, b=(upper-origin)/safeDirection;
    vec3 nearPlane=min(a,b), farPlane=max(a,b);
    float enter=max(0.,max(nearPlane.x,max(nearPlane.y,nearPlane.z)));
    float leave=min(farPlane.x,min(farPlane.y,farPlane.z));

    // Clip volume integration against the actual Cesium globe/terrain/3D depth.
    float depth=texture(depthTexture,v_textureCoordinates).r;
    if(depth>0. && depth<1.) {
        vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);
        leave=min(leave,length(hit.xyz/hit.w));
    }
    if(leave<=enter) { out_FragColor=background; return; }
    float stepSize=(leave-enter)/u_steps;
    float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    float distanceAlong=enter+stepSize*jitter;
    vec4 accumulated=vec4(0.);
    vec3 sun=normalize(vec3(-.65,-.4,.8));
    for(int i=0;i<144;i++) {
        if(float(i)>=u_steps || accumulated.a>.985) break;
        vec3 p=(origin+direction*distanceAlong-lower)/u_dimensions;
        float density=smoke(p);
        if(density>.008) {
            float shadow=smoke(p+sun*.035)*.8+field(p+sun*.09)*.6+field(p+sun*.18)*.3;
            float light=exp(-shadow*u_opacity*1.65);
            vec3 ambient=vec3(.19,.23,.24);
            vec3 lit=vec3(.81,.84,.80);
            vec3 color=mix(ambient,lit,light)*(.84+p.z*.16);
            color=mix(color,vec3(.36,.32,.25),.42*exp(-p.z*18.));
            float alpha=1.-exp(-density*stepSize*.014);
            accumulated.rgb+=(1.-accumulated.a)*color*alpha;
            accumulated.a+=(1.-accumulated.a)*alpha;
        }
        distanceAlong+=stepSize;
    }
    out_FragColor=vec4(accumulated.rgb+background.rgb*(1.-accumulated.a),1.);
}
