precision highp sampler3D;
const float PI=3.14159265359;
const float Rg=6378.137;
uniform sampler2D u_weather;
uniform sampler3D u_noise;
uniform float u_base,u_thickness,u_coverage,u_density,u_detail,u_windAngle;
uniform vec3 u_sun;
vec2 sphere(vec3 p,vec3 d,float r){
    float b=dot(p,d),h=b*b-dot(p,p)+r*r;
    if(h<0.)return vec2(1e9,-1e9);
    return vec2(-b-sqrt(h),-b+sqrt(h));
}
vec3 advect(vec3 p){float c=cos(u_windAngle),s=sin(u_windAngle);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec2 weatherUV(vec3 p){vec3 n=normalize(p);return vec2(atan(n.y,n.x)/(2.*PI)+.5,asin(clamp(n.z,-1.,1.))/PI+.5);}
float cloudDensity(vec3 p,float footprint,bool coarse){
    float h=(length(p)-Rg-u_base)/u_thickness;
    if(h<=0.||h>=1.||u_coverage<=0.)return 0.;
    vec3 q=advect(p);
    vec2 w=texture(u_weather,weatherUV(q)).rg;
    float cover=clamp((w.r+u_coverage-1.)/max(.05,u_coverage),0.,1.);
    if(cover<=0.)return 0.;
    // Mesoscale breakup survives orbital views; the fine volume is filtered out separately.
    vec2 regional=vec2(texture(u_noise,q/900.).g,mix(.5,texture(u_noise,q/180.).r,1.-smoothstep(8.,60.,footprint)));
    cover=clamp(cover+(regional.x-.5)*.7+(regional.y-.5)*.55,0.,1.);
    if(cover<=0.)return 0.;
    float envelope=smoothstep(0.,.08,h);
    float shape=0.;
    float lod=1.-smoothstep(.25,3.,footprint);
    if(!coarse&&lod>.001){vec4 n=texture(u_noise,q/12.);shape=((n.r-.5)*1.4+(n.g-.5)*.6)*lod;}
    // Subtract the vertical profile before clamping: individual lobes have different tops.
    float density=max(0.,cover*.85+shape-.24-pow(h,mix(1.4,3.,w.g))*.75)*envelope;
    if(!coarse&&density>0.&&footprint<.9){
        vec4 n=texture(u_noise,q/4.5);
        density=max(0.,density-(1.-n.b)*u_detail*.12*(1.-smoothstep(.1,.9,footprint))*(1.-envelope*.35));
    }
    return density*5.*u_density;
}
