precision highp sampler3D;
uniform sampler2D u_weather;
uniform sampler3D u_noise;
uniform float u_base,u_thickness,u_coverage,u_density,u_detail,u_windAngle,u_seed;
vec3 advect(vec3 p){float c=cos(u_windAngle),s=sin(u_windAngle);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec2 weatherUV(vec3 p){
    vec3 n=normalize(p);float height=float(textureSize(u_weather,0).y);
    float latitude=asin(clamp(n.z,-1.,1.))/PI+.5;
    return vec2(atan(n.y,n.x)/(2.*PI)+.5,(latitude*(height-1.)+.5)/height);
}
vec2 regionalNoise(vec3 q,float footprint){
    vec2 regional=texture(u_weather,weatherUV(q)).ba;
    return vec2(regional.x,mix(.5,regional.y,1.-smoothstep(20.,90.,footprint)));
}
vec3 cloudWarp(vec3 q){
    return (texture(u_noise,q/73.13+u_seed*.017).rgb-.5)*4.7;
}
float shapeNoise(vec3 q){
    q+=cloudWarp(q);
    vec4 a=texture(u_noise,q/12.+u_seed*.031);
    // A second rotated, incommensurate scale breaks recognisable 12 km lobes.
    vec3 rotated=vec3(dot(q,vec3(.36,.48,-.8)),dot(q,vec3(-.8,.6,0)),dot(q,vec3(.48,.64,.6)));
    vec4 b=texture(u_noise,rotated/19.731+vec3(.13,.57,.29)+u_seed*.011);
    return (a.r-.5)*.95+(a.g-.5)*.35+(b.r-.5)*.65+(b.g-.5)*.35;
}
float cloudDensity(vec3 p,float footprint,bool coarse){
    float h=(length(p)-Rg-u_base)/u_thickness;
    if(h<=0.||h>=1.||u_coverage<=0.)return 0.;
    vec3 q=advect(p);
    vec2 w=texture(u_weather,weatherUV(q)).rg;
    float cover=clamp((w.r+u_coverage-1.)/max(.05,u_coverage),0.,1.);
    if(cover<=0.)return 0.;
    // Mesoscale breakup survives orbital views; the fine volume is filtered out separately.
    vec2 regional=regionalNoise(q,footprint);
    cover=clamp(cover+(regional.x-.5)*.7+(regional.y-.5)*1.3,0.,1.);
    if(cover<=0.)return 0.;
    float envelope=smoothstep(0.,.08,h);
    float shape=0.;
    float lod=1.-smoothstep(.25,3.,footprint);
    if(!coarse&&lod>.001)shape=shapeNoise(q)*lod;
    // Subtract the vertical profile before clamping: individual lobes have different tops.
    float density=max(0.,cover*.85+shape-.24-pow(h,mix(1.4,3.,w.g))*.75)*envelope;
    if(!coarse&&density>0.&&footprint<.9){
        vec4 n=texture(u_noise,(q+cloudWarp(q))/4.517+u_seed*.019);
        density=max(0.,density-(1.-n.b)*u_detail*.12*(1.-smoothstep(.1,.9,footprint))*(1.-envelope*.35));
    }
    return density*5.*u_density;
}
