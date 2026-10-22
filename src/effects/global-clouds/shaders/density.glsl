precision highp sampler3D;
uniform sampler2D u_weather;
uniform sampler3D u_noise;
uniform sampler3D u_voxels;
uniform bool u_voxelReady,u_skipVoxels;
vec4 voxelShape(vec3 p,float footprint);
float voxelBodyDepth(vec3 p,float footprint);
uniform float u_base,u_thickness,u_coverage,u_density,u_detail,u_windAngle,u_seed,u_evolution,u_windSpeed;
uniform float u_cloudType,u_highBase,u_highThickness,u_highCoverage,u_highAngle;
int cloudLayer=0;
float layerBase(){return cloudLayer==0?u_base:u_highBase;}
float layerThickness(){return cloudLayer==0?u_thickness:u_highThickness;}
// Independent of absolute altitude: the same morphology can be moved vertically.
// Weather selects a continuous stratocumulus/cumulus blend in automatic mode.
float cloudTypeValue(float weather){return u_cloudType<.5?mix(.45,1.,smoothstep(.25,.75,weather)):(u_cloudType-1.)*.5;}
float cloudTypeTop(float type){return mix(mix(.26,.58,smoothstep(0.,.5,type)),1.,smoothstep(.5,1.,type));}
vec3 advect(vec3 p){float c=cos(u_windAngle),s=sin(u_windAngle);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec2 weatherUV(vec3 p){
    vec3 n=normalize(p);float height=float(textureSize(u_weather,0).y);
    float latitude=asin(clamp(n.z,-1.,1.))/PI+.5;
    return vec2(atan(n.y,n.x)/(2.*PI)+.5,(latitude*(height-1.)+.5)/height);
}
vec2 regionalNoise(vec3 q,float footprint){
    vec2 regional=textureLod(u_weather,weatherUV(q),0.).ba;
    return vec2(regional.x,mix(.5,regional.y,1.-smoothstep(20.,90.,footprint)));
}
vec4 cellular(vec3 q,float scale,float footprint){
    float lod=max(0.,log2(max(.001,footprint)*64./scale));
    return textureLod(u_noise,q/scale,lod);
}
vec3 cloudWarp(vec3 q){
    vec3 warp=cellular(q,71.3,.01).rga;
    return (warp-.5)*3.4;
}
float lobes(vec3 q,float footprint){
    vec4 a=cellular(q+u_seed*.23,7.83,footprint);
    vec3 rotated=vec3(dot(q,vec3(.36,.48,-.8)),dot(q,vec3(-.8,.6,0)),dot(q,vec3(.48,.64,.6)));
    vec4 b=cellular(rotated+u_seed*.31,13.57,footprint);
    return dot(a.rgb-vec3(.5),vec3(1.2,.55,.25))+(b.r-.5)*.35;
}
float shapeNoise(vec3 q){return lobes(q+cloudWarp(q),.002);}
float lowCloudDensity(vec3 p,float footprint,bool coarse){
    float h=(length(p)-Rg-u_base)/u_thickness;
    if(h<=0.||h>=1.||u_coverage<=0.)return 0.;
    vec3 q=advect(p);
    vec4 w=textureLod(u_weather,weatherUV(q),0.);
    float type=cloudTypeValue(w.g),top=cloudTypeTop(type);
    h/=top;
    if(h>=1.)return 0.;
    float cover=clamp((w.r+u_coverage-1.)/max(.05,u_coverage),0.,1.);
    if(cover<=0.)return 0.;
    cover=clamp(cover+(w.b-.5)*.7+(mix(w.a,.5,smoothstep(20.,90.,footprint))-.5)*1.3,0.,1.);
    if(cover<=0.)return 0.;
    // A vertically coherent mesoscale mask creates genuine sky windows. A
    // different random gap at every altitude still accumulates into overcast.
    vec3 column=normalize(q)*(Rg+u_base);
    float cell=cellular(column+cloudWarp(column)+u_seed*.43,29.713,max(footprint,.04)).r;
    float threshold=mix(.76,.38,cover);
    float cluster=smoothstep(threshold-.035,threshold+.085,cell);
    if(cluster<=.001)return 0.;
    if(u_voxelReady){
        vec4 volume=voxelShape(p,footprint);
        float field=volume.r-(1.-cover)*.22-(1.-cluster)*.3-pow(h,mix(4.,2.8,type))*.4;
        if(field<=0.)return 0.;
        if(!coarse&&footprint<.8){
            vec4 fine=cellular(q+u_seed*.17-vec3(.3,.7,.1)*u_evolution,1.61,footprint);
            float wisps=1.-abs(2.*fine.a-1.),billows=dot(fine.rgb,vec3(.55,.3,.15));
            float folded=abs(2.*abs(2.*fine.g-1.)-1.);
            float detail=mix(wisps,billows,volume.a);
            detail=mix(detail,mix(1.-pow(folded,3.),folded*folded,volume.a),1.-smoothstep(.015,.12,footprint));
            // Erosion only removes material, preserving the baked distance bound.
            field-=(1.-detail)*u_detail*.28*(1.-smoothstep(.15,.8,footprint));
        }
        float body=smoothstep(0.,.32+min(.15,footprint*.2),field);
        return body*cluster*smoothstep(0.,.2,cover)*smoothstep(0.,.045,h)*(1.-smoothstep(.9,1.,h))*9.*u_density;
    }
    float shape=0.;
    float lod=1.-smoothstep(.35,3.,footprint);
    vec3 east=normalize(abs(q.z)/length(q)>.9999?vec3(1,0,0):vec3(-q.y,q.x,0));
    vec3 vertical=normalize(q),north=cross(vertical,east);
    // Weather advects as a whole, while wind shear leans the upper cloud and
    // the two noise bands evolve at different rates within that moving weather.
    float shear=clamp(u_windSpeed/80.,0.,1.5)*u_thickness*.55*h*h;
    vec3 warped=q+east*(shear+u_evolution)+north*(u_evolution*.17)+vertical*(u_evolution*.23);
    if(lod>.001){warped+=cloudWarp(q);shape=lobes(warped,footprint)*lod*mix(.45,1.,type);}
    // Coverage must open gaps through the whole column, including its underside.
    // The earlier low threshold filled most cloud bases into a continuous lid.
    float field=cover*.9+shape-.40-(1.-cluster)*.5-pow(h,mix(4.,2.8,type))*.72;
    if(field<=0.)return 0.;
    if(!coarse&&footprint<.8){
        vec3 detail=cellular(warped-east*u_evolution*1.7+u_seed*.17,1.61,footprint).rgb;
        float erosion=dot(1.-detail,vec3(.55,.3,.15));
        field-=erosion*u_detail*.24*(1.-smoothstep(.15,.8,footprint));
    }
    // A finite transition into optically thick droplets, rather than kilometres
    // of dilute fog. The footprint broadens the boundary only when unresolved.
    float boundary=.10+min(.16,footprint*.3);
    float body=smoothstep(0.,boundary,field);
    return body*smoothstep(0.,.045,h)*(1.-smoothstep(.92,1.,h))*7.*u_density;
}

// A finite, sparse ice layer. Directional world-space domains avoid longitude
// seams/pole singularities; warped noncommensurate bands avoid repeated tiles.
// This is procedural cirrus, not a voxel-authored Nubis asset or ice microphysics.
float highCloudDensity(vec3 p,float footprint){
    if(u_highCoverage<=0.)return 0.;
    float h=(length(p)-Rg-u_highBase)/u_highThickness;
    if(h<=0.||h>=1.)return 0.;
    float c=cos(u_highAngle),s=sin(u_highAngle);
    vec3 q=vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
    vec3 column=normalize(q)*(Rg+u_highBase);
    vec4 weather=textureLod(u_weather,weatherUV(column+vec3(740,-310,570)),0.);
    float warp=cellular(column+u_seed*.71,173.1,footprint).a-.5;
    // Stretch along a world axis; its projection is a continuous tangent flow.
    // Near that axis's poles the strands naturally shorten instead of forming
    // an equirectangular seam or a singular local tangent frame.
    vec3 domain=column;
    domain+=vec3(warp*15.,warp*3.,warp*9.)+u_seed*.37;
    float curl=cellular(column+vec3(37,-53,81),23.7,footprint).a-.5;
    domain+=vec3(0,curl*1.6,curl*1.1);
    float broad=cellular(column+vec3(83,121,-71),119.3,footprint).a;
    float envelope=smoothstep(.44,.64,broad+(weather.b-.5)*.22+(u_highCoverage-.35)*.65);
    if(envelope<.001)return 0.;
    vec3 stretch=vec3(.035,1.,1.);
    domain+=vec3(h*4.,h*.2,0.);
    float fiber=cellular(domain*stretch,7.1,footprint).a;
    float breakup=cellular(domain+vec3(32,-51,71),17.3,footprint).a;
    float fine=cellular(domain*vec3(.025,1.,1.)+vec3(13,27,91),3.1,footprint).a;
    float strands=fiber+(breakup-.5)*.2+(fine-.5)*.16;
    float mask=(smoothstep(.53,.7,strands)+.12*smoothstep(.38,.6,strands))*smoothstep(.28,.65,breakup);
    float vertical=smoothstep(0.,.22,h)*(1.-smoothstep(.48,1.,h));
    return envelope*mask*vertical*.26;
}
float cloudDensity(vec3 p,float footprint,bool coarse){
    return cloudLayer==0?lowCloudDensity(p,footprint,coarse):highCloudDensity(p,footprint);
}
