float debugMipA=-1.,debugMipB=-1.;
// Height shear reaches the production voxel branch. A spherical flow has no
// polar frame switch and vanishes continuously at its stagnation points.
// Bound the shear singular value plus its spherical-flow derivative.
float voxelStretch(){float w=clamp(u_windSpeed/80.,0.,1.5);return sqrt(1.+.0484*w*w)+.22*w+.01;}
vec3 voxelPosition(vec3 p){
    vec3 q=advect(p),n=normalize(q);float h=length(q)-Rg-u_base;
    vec3 flow=cross(vec3(.23,-.37,.90),n);
    return q+flow*(.22*clamp(u_windSpeed/80.,0.,1.5)*h*h/u_thickness)+vec3(.81,.27,.13)*u_evolution;
}
vec3 voxelRotate(vec3 q){return vec3(dot(q,vec3(.36,.48,-.8)),dot(q,vec3(-.8,.6,0)),dot(q,vec3(.48,.64,.6)));}
vec4 voxelAt(vec3 q,float scale,float footprint){
    float lod=max(0.,log2(max(.001,footprint)*128./scale));
    if(scale<10.)debugMipA=max(debugMipA,min(7.,lod));else debugMipB=max(debugMipB,min(7.,lod));
    return textureLod(u_voxels,q/scale,lod);
}
vec4 voxelShape(vec3 p,float footprint){
    vec3 q=voxelPosition(p);
    footprint*=voxelStretch();
    vec4 a=voxelAt(q+u_seed*.23,7.83,footprint),b=voxelAt(voxelRotate(q)+u_seed*.31,13.57,footprint);
    // The union's support is bounded by the minimum of both empty distances.
    // Canonicalize internal depth to domain A units before selecting the union.
    // A value from B spans 13.57 km, not 7.83 km. Do not rescale its density.
    return a.r>b.r*.8?a:vec4(b.r*.8,b.g,b.b*(13.57/7.83),b.a);
}
float voxelEmptyDistance(vec3 p,float footprint){
    // The connected world body can occupy the old voxel's empty cells. That
    // EDT bounds only the residual, so it must not skip the combined medium.
    // The stretch bound remains valid for voxel filtering and interior depth.
    return 0.;
}
float voxelBodyDepth(vec3 p,float footprint){
    if(!u_voxelReady||cloudLayer!=0)return 0.;
    vec4 v=voxelShape(p,footprint);
    float h=length(p)-Rg-u_base;
    // A local interior proxy, capped by the layer boundaries. Weather/erosion
    // can remove mass, so illumination also weights it by the actual density.
    return max(0.,min(v.b*(16./128.)*7.83/voxelStretch(),min(h,u_thickness-h)));
}
