vec3 voxelPosition(vec3 p){return advect(p)+vec3(.81,.27,.13)*u_evolution;}
vec3 voxelRotate(vec3 q){return vec3(dot(q,vec3(.36,.48,-.8)),dot(q,vec3(-.8,.6,0)),dot(q,vec3(.48,.64,.6)));}
vec4 voxelAt(vec3 q,float scale,float footprint){
    float lod=max(0.,log2(max(.001,footprint)*128./scale));
    return textureLod(u_voxels,q/scale,lod);
}
vec4 voxelShape(vec3 p,float footprint){
    vec3 q=voxelPosition(p);
    vec4 a=voxelAt(q+u_seed*.23,7.83,footprint),b=voxelAt(voxelRotate(q)+u_seed*.31,13.57,footprint);
    // The union's support is bounded by the minimum of both empty distances.
    return a.r>b.r*.8?a:vec4(b.r*.8,b.g,b.b,b.a);
}
float voxelEmptyDistance(vec3 p,float footprint){
    if(!u_voxelReady||!u_skipVoxels||cloudLayer!=0||farCloudWeight(footprint)>0.)return 0.;
    vec3 q=voxelPosition(p);
    float a=textureLod(u_voxels,(q+u_seed*.23)/7.83,0.).g*(16./128.)*7.83;
    float b=textureLod(u_voxels,(voxelRotate(q)+u_seed*.31)/13.57,0.).g*(16./128.)*13.57;
    // Trilinear mip filtering includes the next coarser level. Box support plus
    // interpolation reaches < 3*sqrt(3)*footprint; round up conservatively.
    return max(0.,min(a,b)-6.*footprint);
}
float voxelBodyDepth(vec3 p,float footprint){
    if(!u_voxelReady||cloudLayer!=0)return 0.;
    vec4 v=voxelShape(p,footprint);
    float h=length(p)-Rg-u_base;
    // A local interior proxy, capped by the layer boundaries. Weather/erosion
    // can remove mass, so illumination also weights it by the actual density.
    return max(0.,min(v.b*(16./128.)*7.83,min(h,u_thickness-h)));
}
