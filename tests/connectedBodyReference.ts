/** Pointwise material mirror for independent square/path quadrature. Does not
 * call the production far rule, Q, response cache or path-profile helper. */
export const connectedBodyReference=`
float referenceCluster(vec3 q,float cover,float type){
 q+=vec3(.20,.13,.07)*u_evolution;
 vec4 bank=cellular(q,213.9,.04),lobes=cellular(q+(bank.rga-.5)*11.4+u_seed*.43,71.3,.04);
 float cell=mix(lobes.a,bank.a,mix(.62,.45,type));
 float threshold=mix(.61,.36,cover)-.035*(1.-type);
 return smoothstep(threshold-.05,threshold+.085,cell);
}
vec3 referenceBody(vec3 q,float cover,float type,float cluster){
 q+=vec3(.81,.27,.13)*u_evolution;
 vec2 roof=cellular(q+u_seed*.61,4.7,.04).rg;vec2 cap=sqrt(max(vec2(0),1.-pow(clamp((1.-roof)/.85,0.,1.),vec2(2))));vec4 detail=cellular(q+u_seed*.19,23.9,.04);float shape=detail.a,bottom=.015+.045*shape;
 float typeTop=mix(mix(.26,.58,smoothstep(0.,.5,type)),1.,smoothstep(.5,1.,type));
 float strength=smoothstep(mix(.36,.42,type),mix(.63,.70,type),mix(cellular(q+u_seed*.19,71.3,.04).a,shape,mix(.25,.45,type))+.1*(cluster-.5));
 float top=min(1.,max(bottom+.001,bottom+typeTop*clamp(mix(.38,.72,type)+mix(.20,.28,type)*shape+dot(detail.rgb-vec3(shape),vec3(.35,.2,.1))+dot(cap-.75,vec2(.35,.15)),.15,1.12)*sqrt(max(0.,cluster*strength))));
 float tau=9.*u_thickness*mix(.16,.30,type)*pow(cluster,1.6)*strength*smoothstep(0.,.2,cover)*mix(.65,1.,shape);
 return vec3(tau,bottom,top);
}`;
