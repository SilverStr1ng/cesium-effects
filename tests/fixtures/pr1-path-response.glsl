#ifdef LAYERED_CLOUDS
// A long view must retain each spatial child's correlation through changing
// world columns. Density-only quadrature accumulates that child's T first;
// illumination is evaluated once per absorption-weighted response bin, not at
// every density step. This is a bounded source approximation, not a reference.
void prepareWorldResponse(vec3 origin,vec3 direction,vec2 path,float footprint,int count,vec3 sun,vec3 moon,bool moonActive){
    vec3 middle=origin+direction*((path.x+path.y)*.5);
    float drift=length(cross(direction,normalize(middle)))*(path.y-path.x);
    float blend=smoothstep(4.,12.,drift);
    worldResponseActive=false;
    CloudPhases phases=scatteringPhases(direction);
    farPathOrigin=origin;farPathDirection=direction;farPath=path;
    farResponseCount=min(FAR_RESPONSE_LIMIT,max(1,count));farPathCurve=1.-smoothstep(10.,250.,path.x);
    for(int i=0;i<=FAR_RESPONSE_LIMIT;i++){farResponse[i]=vec4(0);if(i<FAR_RESPONSE_LIMIT)worldRadiance[i]=vec3(0);}
    int rays=int(u_columnComponents)*8;
    vec3 right=cloudScreenRight-direction*dot(direction,cloudScreenRight),up=cloudScreenUp-direction*dot(direction,cloudScreenUp);
    float firstRadius=length(origin+direction*path.x),lastRadius=length(origin+direction*path.y);
    bool firstShell=path.x>0.&&abs(firstRadius-(Rg+u_base+u_thickness))<.02;
    bool lastBase=abs(lastRadius-(Rg+u_base))<.02,lastShell=abs(lastRadius-(Rg+u_base+u_thickness))<.02;
    #ifdef CLOUD_DIAGNOSTICS
    cloudWork.x+=1.;
    #endif
    for(int ray=0;ray<rays;ray++){
      vec2 uv=fract(.5+float(ray+1)*vec2(.7548776662466927,.5698402909980532))-.5;
      vec3 child=origin+footprint*(right*uv.x+up*uv.y);
      vec2 outer=sphere(child,direction,Rg+u_base+u_thickness),inner=sphere(child,direction,Rg+u_base);
      vec2 leg=path;
      if(firstShell)leg.x=max(0.,outer.x);
      if(lastBase)leg.y=inner.x>leg.x?inner.x:inner.y;
      else if(lastShell)leg.y=outer.y;
      float T=1.,tau=0.;
      #ifdef CLOUD_DIAGNOSTICS
      cloudWork.y+=1.;
      #endif
      for(int node=0;node<farResponseCount;node++){
        float a=float(node)/float(farResponseCount),b=float(node+1)/float(farResponseCount);
        float begin=mix(leg.x,leg.y,mix(a,a*a,farPathCurve)),end=mix(leg.x,leg.y,mix(b,b*b,farPathCurve));
        int samples=max(2,min(16,int(ceil(max(0.,end-begin)/.65))));
        float ds=max(0.,end-begin)/float(samples);
        vec3 photon=vec3(0);float mass=0.;
        // Neither this footprint nor the axial support is forced to mip zero.
        float support=max(.02,max(footprint/sqrt(float(rays))*.5,ds*.35));
        for(int j=0;j<samples;j++){
          vec3 p=child+direction*(begin+(float(j)+.5)*ds);
          float rho=lowCloudDensity(p,support,false),attenuation=exp(-rho*ds),absorbed=T*(1.-attenuation);
          photon+=absorbed*p;mass+=absorbed;T*=attenuation;tau+=rho*ds;
        }
        if(mass>1e-7){
          vec3 p=photon/mass;float rho=lowCloudDensity(p,support,false);
          // Query local support again at the actual lighting location.
          worldRadiance[node]+=mass*resolvedIllumination(p,rho,support,phases)/float(rays);
        }
        farResponse[node+1]+=vec4(1.-T,0.,T<.9?1.:0.,tau)/float(rays);
      }
    }
    worldResponseActive=true;
    vec4 end=farResponse[farResponseCount];farMoments=vec4(end.r,end.a,0.,end.b);
}

#endif
#define prepareFarResponse prepareWorldResponse
