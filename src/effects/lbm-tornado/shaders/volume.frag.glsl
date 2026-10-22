uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D u_density;
uniform sampler3D u_noise;
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

vec2 slice(vec2 xy,float z) {
    vec2 tile=vec2(mod(z,u_tiles.x),floor(z/u_tiles.x));
    vec2 uv=(tile*u_grid.xy+.5+xy*(u_grid.xy-1.))/(u_tiles*u_grid.xy);
    return texture(u_density,uv).rg;
}
vec2 field(vec3 p) {
    if(any(lessThan(p,vec3(0)))||any(greaterThan(p,vec3(1))))return vec2(0);
    float z=p.z*(u_grid.z-1.);
    return mix(slice(p.xy,floor(z)),slice(p.xy,min(floor(z)+1.,u_grid.z-1.)),fract(z));
}
// One hardware trilinear fetch supplies four periodic cloud scales. Coherent
// angular shear produces rolling lobes, rather than a stack of rotating rings.
vec3 cloud(vec3 p) {
    vec2 medium=field(p);
    if(medium.r<.015)return vec3(0);
    vec2 radial=(p.xy-.5)*2.;
    float r=length(radial);
    // Bounded differential shear: an unbounded time/radius term eventually
    // winds every noise feature into subpixel rings during a long session.
    float angle=.9*p.z-u_time*.22*u_swirl+.65*sin(r*6.-u_time*.35*u_swirl+p.z*3.);
    float c=cos(angle),s=sin(angle);
    vec3 flow=vec3(mat2(c,-s,s,c)*radial,p.z*.95-u_time*.032*u_updraft);
    vec4 n=texture(u_noise,flow*.82+vec3(.19,.37,.11));
    vec3 warp=(n.gba-.5)*(.055+.055*u_turbulence);
    medium=field(p+warp*vec3(1.,1.,.55));
    vec4 fine=texture(u_noise,flow*2.1+warp+vec3(.51,.13,.73));
    float erosion=mix(.24,.07,exp(-p.z*8.));
    float billow=(n.r-.5)*.95+(n.g-.5)*.7+(fine.g-.5)*.4;
    float density=max(0.,medium.r+billow-erosion);
    density*=.7+1.5*n.r+.3*fine.b;
    // Cached large-scale optical depth + local detail gradient for billow lighting.
    vec4 sunNoise=texture(u_noise,flow*.82+vec3(.19,.37,.11)+vec3(-.018,-.011,.018));
    float detailLight=clamp(.58+(n.r-sunNoise.r)*7.+(n.g-sunNoise.g)*3.+(n.b-sunNoise.b)*.5,.12,1.);
    return vec3(density*u_opacity,medium.g*12.,detailLight);
}
void main() {
    vec4 background=texture(colorTexture,v_textureCoordinates);
    vec4 rayEC=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1.,1.);
    vec3 origin=u_viewToLocal[3].xyz;
    vec3 direction=normalize(mat3(u_viewToLocal)*normalize(rayEC.xyz/rayEC.w));
    vec3 lower=vec3(-u_dimensions.xy*.5,0.);
    vec3 upper=vec3(u_dimensions.xy*.5,u_dimensions.z);
    vec3 safeDirection=mix(vec3(1e-7),direction,greaterThan(abs(direction),vec3(1e-7)));
    vec3 a=(lower-origin)/safeDirection,b=(upper-origin)/safeDirection;
    vec3 nearPlane=min(a,b),farPlane=max(a,b);
    float enter=max(0.,max(nearPlane.x,max(nearPlane.y,nearPlane.z)));
    float leave=min(farPlane.x,min(farPlane.y,farPlane.z));
    float depth=texture(depthTexture,v_textureCoordinates).r;
    if(depth>0.&&depth<1.) {
        vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);
        leave=min(leave,length(hit.xyz/hit.w));
    }
    if(leave<=enter){out_FragColor=background;return;}
    float ds=(leave-enter)/u_steps;
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float t=enter+ds*jitter;
    vec4 accumulated=vec4(0);
    float silver=pow(max(0.,dot(direction,normalize(vec3(-.8,-.5,1.)))),6.)*.35;
    for(int i=0;i<144;i++) {
        if(float(i)>=u_steps||accumulated.a>.992)break;
        vec3 p=(origin+direction*t-lower)/u_dimensions;
        vec3 sampleValue=cloud(p);
        if(sampleValue.x>.008){
            float optical=sampleValue.y*u_opacity;
            float direct=exp(-optical*1.15);
            float scattered=.25*exp(-optical*.25);
            float lighting=clamp(direct+scattered,0.,1.);
            vec3 dark=vec3(.24,.3,.38);
            vec3 bright=vec3(.78,.9,.94);
            vec3 color=mix(dark,bright,lighting)*(.4+.75*sampleValue.z);
            color+=silver*exp(-optical*.6)*vec3(.64,.75,.87);
            color=mix(color,vec3(.29,.28,.25),exp(-p.z*20.)*.4);
            float alpha=1.-exp(-sampleValue.x*ds*.0048);
            accumulated.rgb+=(1.-accumulated.a)*color*alpha;
            accumulated.a+=(1.-accumulated.a)*alpha;
        }
        t+=ds;
    }
    out_FragColor=vec4(accumulated.rgb+background.rgb*(1.-accumulated.a),1.);
}
