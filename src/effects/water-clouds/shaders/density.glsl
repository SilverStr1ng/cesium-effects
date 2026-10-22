precision highp sampler3D;
uniform sampler2D u_weather;
uniform sampler3D u_noise;
uniform float u_base,u_thickness,u_coverage,u_density,u_detail,u_seed,u_windAngle,u_evolution,u_windSpeed;
vec3 waterWind(vec3 p){float c=cos(u_windAngle),s=sin(u_windAngle);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec4 waterNoise(vec3 p,float scale,float footprint){
    float lod=max(0.,log2(max(.001,footprint)*64./scale));
    return textureLod(u_noise,p/scale,lod);
}
vec3 rotateWeather(vec3 p){return vec3(dot(p,vec3(.36,.48,-.8)),dot(p,vec3(-.8,.6,0)),dot(p,vec3(.48,.64,.6)));}
float cloudDensity(vec3 p,float footprint,bool coarse){
    float h=(length(p)-Rg-u_base)/u_thickness;
    if(h<=0.||h>=1.||u_coverage<=0.||u_density<=0.)return 0.;
    vec3 q=waterWind(p),up=normalize(q),column=up*(Rg+u_base);
    float mapHeight=float(textureSize(u_weather,0).y);
    vec2 uv=vec2(atan(up.y,up.x)/(2.*PI)+.5,((asin(clamp(up.z,-1.,1.))/PI+.5)*(mapHeight-1.)+.5)/mapHeight);
    vec4 weather=textureLod(u_weather,uv,0.);
    // Once kilometre-scale cloud lobes are subpixel, filtering their noise and
    // then thresholding it aliases badly. Integrate a weather-derived fractional
    // optical depth instead, fading continuously to the resolved near medium.
    float distant=smoothstep(.6,4.,footprint);
    float macroDensity=0.;
    if(distant>0.){
        float macroCoverage=smoothstep(0.,.45,weather.r+u_coverage-1.+(weather.b-.5)*.4);
        float profile=smoothstep(0.,.15,h)*(1.-smoothstep(.55,.95,h));
        macroDensity=-log(max(.08,1.-macroCoverage*.92))*profile*u_density/(u_thickness*.67);
    }
    if(distant>.999)return macroDensity;
    // Continuous spherical weather height, with independent local/continental scales.
    // There is no repeated planar weather tile and no hard binary cluster mask.
    vec3 offset=vec3(u_seed*.71,u_seed*.37,u_seed*.53);
    float local=waterNoise(column+offset,83.1,footprint).a*.7+
        waterNoise(rotateWeather(column)-offset,47.7,footprint).a*.3;
    float mass=clamp(.35+(local-.5)*2.9+(weather.r-.5)*.8+(weather.b-.5)*.45,0.,1.);
    vec3 east=normalize(abs(up.z)>.9999?vec3(1,0,0):vec3(-up.y,up.x,0));
    vec3 shape=q-east*(h*u_thickness*clamp(u_windSpeed/150.,0.,1.)*.35)+east*u_evolution;
    vec4 base=waterNoise(shape+offset,7.5,footprint);
    // Weather defines a column, positive cellular dilation builds its lobes.
    // Sparse weather removes the lower column rather than raising a hard slab.
    float dilation=dot(base.rgb,vec3(.70,.41,.23))*.69;
    float top=clamp(mass+u_coverage-1.+dilation*u_coverage,0.,1.);
    float support=smoothstep(0.,.08,top),floorHeight=0.;
    // Resolve a physical transition layer before considering pixel filtering.
    // A narrow threshold made this height field look like a solid isosurface.
    float edge=.055+min(.04,footprint*.12);
    if(top+edge<h||floorHeight-edge>h)return macroDensity*distant;
    if(!coarse){
        float localHeight=clamp(h/max(.001,top),0.,1.);
        vec3 fine=waterNoise(rotateWeather(shape)-east*u_evolution*.6+offset,.975,footprint).rgb;
        float carve=dot(fine,vec3(.113,.04,.02));
        float erosion=carve*(u_detail/.55)*mix(.24,2.15,localHeight)*u_coverage;
        top-=erosion;floorHeight=erosion;
    }
    float body=smoothstep(-edge,edge,top-h)*smoothstep(0.,edge,h-floorHeight);
    float requiredWeather=(1.-smoothstep(0.,.13,h))*.54;
    body*=support*smoothstep(requiredWeather-.1,requiredWeather,mass);
    body*=smoothstep(0.,.025,h)*(1.-smoothstep(.94,1.,h));
    // Extinction in km^-1. Dense cores remain opaque; the soft boundaries carry
    // the optically thin detail instead of lowering opacity over the whole cloud.
    return mix(body*16.*u_density,macroDensity,distant);
}
