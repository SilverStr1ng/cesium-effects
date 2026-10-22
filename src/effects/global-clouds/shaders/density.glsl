precision highp sampler3D;
uniform sampler2D u_weather;
uniform sampler3D u_noise;
uniform sampler3D u_voxels;
uniform sampler3D u_cloudOptics;
uniform sampler3D u_cirrus;
uniform bool u_opticsReady;
// Runtime bound avoids ANGLE unrolling 144 texture-heavy subcolumns into each
// density/light call. Production fixes this to 12 at every quality.
uniform float u_columnGrid;
uniform bool u_voxelReady,u_skipVoxels;
vec4 voxelShape(vec3 p,float footprint);
float voxelBodyDepth(vec3 p,float footprint);
uniform float u_base,u_thickness,u_coverage,u_density,u_detail,u_windAngle,u_seed,u_evolution,u_windSpeed;
uniform float u_cloudType,u_highBase,u_highThickness,u_highCoverage,u_highAngle;
int cloudLayer=0;
float cloudSlant=1.;
vec3 cloudRay=vec3(0,0,1);
vec3 cloudScreenRight=vec3(1,0,0),cloudScreenUp=vec3(0,1,0);
float cloudStep=0.;
// 0 = automatic (probes), 1 = resolved segment, 2 = statistical segment.
// Production blends completed segment L/T, never extinction coefficients.
int cloudRepresentation=0;
float farCloudWeight(float footprint){
    if(!u_opticsReady)return 0.;
    if(cloudRepresentation==1)return 0.;
    if(cloudRepresentation==2)return 1.;
    return smoothstep(.35,2.,footprint);
}
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
vec2 cloudWeather(vec3 p,float footprint){
    vec4 w=textureLod(u_weather,weatherUV(advect(p)),0.);
    float cover=clamp((w.r+u_coverage-1.)/max(.05,u_coverage),0.,1.);
    if(cover>0.)cover=clamp(cover+(w.b-.5)*.7+(w.a-.5)*1.3,0.,1.);
    return vec2(cover,cloudTypeValue(w.g));
}
vec4 materialOptics(float cut,float type,float scale){
    vec3 uv=vec3(clamp(cut/.52,0.,1.),type,clamp((log2(max(.03125,scale))+5.)/12.,0.,1.));
    vec4 moments=texture(u_cloudOptics,(uv*31.+.5)/32.);
    float thin=min(1.,scale/.03125);
    return vec4(moments.r*thin,moments.g/max(1./255.,1.-moments.g)*scale,moments.b*thin,moments.a*thin);
}
vec4 farMoments=vec4(0);
vec3 farAnchor=vec3(1e8);
float farTop=1.,farFootprint=-1.,farSlant=-1.,farShape=64.;
// 144 world-local subcolumns filter the nonlinear cluster and final T. The
// conditional material table filters unresolved voxels, NOT their mean noise.
// Cached along a ray, at half-footprint spacing; no extra GPU texture.
void prepareFarColumns(vec3 p,float footprint){
    vec3 column=normalize(p)*(Rg+u_base);
    if(distance(column,farAnchor)<max(.25,footprint*.5)&&abs(footprint-farFootprint)<max(.01,footprint*.05)&&abs(cloudSlant-farSlant)<cloudSlant*.05)return;
    farAnchor=column;farFootprint=footprint;farSlant=cloudSlant;farMoments=vec4(0);farTop=0.;
    // Transport the camera footprint onto the local tangent plane. A world-Z
    // / world-Y frame switch would rotate the filter abruptly near the poles.
    // Rodrigues' shortest rotation has no longitude seam. The grazing stretch
    // uses the same bounded slant as transport, continuously through tangency.
    vec3 n=normalize(column),rotation=cross(-cloudRay,n);
    float denominator=max(.001,1.-dot(cloudRay,n));
    vec3 east=cloudScreenRight-cloudRay*dot(cloudRay,cloudScreenRight);
    vec3 north=cloudScreenUp-cloudRay*dot(cloudRay,cloudScreenUp);
    east+=cross(rotation,east)+cross(rotation,cross(rotation,east))/denominator;
    north+=cross(rotation,north)+cross(rotation,cross(rotation,north))/denominator;
    vec3 tangent=cloudRay-n*dot(n,cloudRay);
    float stretch=(cloudSlant-1.)/max(1e-6,dot(tangent,tangent));
    east+=tangent*dot(east,tangent)*stretch;north+=tangent*dot(north,tangent)*stretch;
    // A 4x4 rule is a subset of the 12x12 rule (indices 1,4,7,10).
    // Blend their final moments continuously over 4-12 km. At low orbit this
    // needs only 16 subcolumns; quality never selects another weather field.
    float detailed=smoothstep(4.,12.,footprint);
    int grid=detailed<=0.?4:int(u_columnGrid);float count=float(grid*grid);
    for(int y=0;y<grid;y++)for(int x=0;x<grid;x++){
        float weight=detailed/count+(1.-detailed)*(grid==4||((x%3)==1&&(y%3)==1)?1./16.:0.);
        vec2 offset=(vec2(x,y)+.5)/float(grid)-.5;
        vec3 samplePoint=normalize(column+footprint*(east*offset.x+north*offset.y))*(Rg+u_base);
        vec2 weather=cloudWeather(samplePoint,footprint);
        float top=cloudTypeTop(weather.y);farTop+=top*weight;
        if(weather.x<=0.)continue;
        vec3 q=advect(samplePoint);
        float cell=cellular(q+cloudWarp(q)+u_seed*.43,29.713,.04).r;
        float threshold=mix(.76,.38,weather.x),cluster=smoothstep(threshold-.035,threshold+.085,cell);
        float scale=u_density*u_thickness/3.8*cloudSlant*cluster*smoothstep(0.,.2,weather.x);
        vec4 m=materialOptics((1.-weather.x)*.22+(1.-cluster)*.3,weather.y,scale);
        farMoments+=vec4(m.r,m.g,m.b*m.r,m.a)*weight;
    }
    farMoments.b/=max(.0001,farMoments.r);
    // Fit a positive conditional optical-depth distribution to BOTH E[tau]
    // and E[T]. Exponentiating only the conditional mean over-darkens the
    // unresolved light path (the same Jensen error as viewing transmission).
    float area=max(.001,farMoments.a),mean=farMoments.g/area;
    float target=-log(max(.00001,1.-farMoments.r/area));
    float lo=.015625,hi=64.;
    for(int i=0;i<10;i++){
        float k=sqrt(lo*hi);
        if(k*log(1.+mean/k)<target)lo=k;else hi=k;
    }
    farShape=sqrt(lo*hi);
}
float farCloudDensity(vec3 p,float footprint){
    if(u_coverage<=0.||u_density<=0.)return 0.;
    prepareFarColumns(p,footprint);
    float top=farTop,h=(length(p)-Rg-u_base)/(u_thickness*top);
    if(h<=0.||h>=1.||farMoments.r<=0.)return 0.;
    // Unit-integral vertical volume profile. Its column extinction is the
    // preintegrated transmission of many resolved, correlated voxel columns.
    float profile=12.*h*(1.-h)*(1.-h);
    return -log(max(1./65536.,1.-farMoments.r))*profile/(u_thickness*top*cloudSlant);
}
float farCloudLightDepth(vec3 p,vec3 light,float footprint){
    float top=farTop;
    float h=clamp((length(p)-Rg-u_base)/(u_thickness*top),0.,1.),mu=dot(normalize(p),light);
    float below=h*h*(6.-8.*h+3.*h*h);
    // Match the resolved model's finite 1.5 km self-shadow domain. A full slab
    // shadow here changed the illumination law just by zooming out.
    float end=clamp(h+mu*1.5/(u_thickness*top),0.,1.);
    float endBelow=end*end*(6.-8.*end+3.*end*end);
    float fraction=abs(mu)>.005?abs(endBelow-below)/abs(mu):12.*h*(1.-h)*(1.-h)*1.5/(u_thickness*top);
    // Condition on cloudy area before self-shadowing; clear subcolumns have
    // already contributed their transmission to the viewing-ray mixture.
    float conditionalDepth=farMoments.g/max(.02,farMoments.a)/max(1.,cloudSlant);
    return min(32.,conditionalDepth*fraction);
}
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
    cover=clamp(cover+(w.b-.5)*.7+(w.a-.5)*1.3,0.,1.);
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
vec3 cirrus(vec3 domain,vec3 stretch,float scale,float footprint){
    // A long integration interval parallel to a strand does not have the same
    // bandwidth as one crossing it. Include the domain's directional derivative.
    float c=cos(u_highAngle),s=sin(u_highAngle);
    vec3 ray=vec3(c*cloudRay.x-s*cloudRay.y,s*cloudRay.x+c*cloudRay.y,cloudRay.z);
    float support=max(footprint,length(ray*stretch)*cloudStep*.5);
    float lod=max(0.,log2(max(.001,support)*64./scale));
    return textureLod(u_cirrus,domain*stretch/scale,lod).rgb;
}
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
    float broad=cirrus(column+vec3(83,121,-71),vec3(1),119.3,footprint).g;
    float envelope=clamp(broad+(weather.b-.5)*.22+(u_highCoverage-.35)*1.3,0.,1.)*smoothstep(0.,.08,u_highCoverage);
    if(envelope<.001)return 0.;
    // Hundreds of metres across, tens of kilometres along the flow. Kilometre-
    // wide value-noise lobes produced soft cumulus-shaped smears at this height.
    vec3 stretch=vec3(.012,1.,1.);
    domain+=vec3(h*4.,h*.2,0.);
    float fiber=cirrus(domain,stretch,2.1,footprint).r;
    float breakup=cirrus(domain+vec3(32,-51,71),vec3(1),17.3,footprint).b;
    float fine=cirrus(domain+vec3(13,27,91),vec3(.008,1.,1.),.71,footprint).r;
    float mask=(fiber*.84+fine*.16)*1.12*breakup;
    float vertical=smoothstep(0.,.22,h)*(1.-smoothstep(.48,1.,h));
    return envelope*mask*vertical*.26;
}
float cloudDensity(vec3 p,float footprint,bool coarse){
    if(cloudLayer==1)return highCloudDensity(p,footprint);
    float far=farCloudWeight(footprint);
    if(far>=1.)return farCloudDensity(p,footprint);
    // The caller integrates each representation separately during transition.
    return lowCloudDensity(p,footprint,coarse);
}
