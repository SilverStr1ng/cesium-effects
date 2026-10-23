// A segment contains only emitted/scattered radiance and transmission, never
// its background. Air and cloud coexist in the SAME analytic sample integral.
struct CloudSegment {vec3 L;vec3 T;vec3 airL;vec3 airT;float cloudT;};
CloudSegment emptyCloudSegment(){return CloudSegment(vec3(0),vec3(1),vec3(0),vec3(1),1.);}
void cloudTransportStep(inout CloudSegment s,vec3 airSource,vec3 airExtinction,float rho,vec3 cloudSource,float ds){
    vec3 extinction=airExtinction+rho;
    s.L+=s.T*(airSource+rho*cloudSource)*integralWeight(extinction,ds);
    s.T*=exp(-extinction*ds);
    s.airL+=s.airT*airSource*integralWeight(airExtinction,ds);
    s.airT*=exp(-airExtinction*ds);s.cloudT*=exp(-rho*ds);
}
CloudSegment mixCloudSegments(CloudSegment a,CloudSegment b,float f){
    CloudSegment s=emptyCloudSegment();s.cloudT=mix(a.cloudT,b.cloudT,f);
    s.airL=mix(a.airL,b.airL,f);s.airT=mix(a.airT,b.airT,f);
    // Blend completed transport, including the cloud-induced foreground-air
    // contribution. Never blend extinction or duplicate cloud mass.
    s.L=mix(a.L-a.cloudT*a.airL,b.L-b.cloudT*b.airL,f)+s.cloudT*s.airL;
    s.T=s.airT*s.cloudT;return s;
}
void appendCloudSegment(CloudSegment s,inout vec4 clouds,inout vec3 airL,inout vec3 airT){
    // The background already contains clear-air radiance A and transmission.
    // C + Tc*background is exact for this discretization when
    // Cseg = Lmixed - Tc*Lclear. Add only the displaced foreground air, so air
    // inside clouds and between layers is neither omitted nor counted twice.
    vec3 correction=max(vec3(0),s.L-s.cloudT*s.airL);
    clouds.rgb+=(1.-clouds.a)*(airT*correction+airL*(1.-s.cloudT));
    clouds.a+=(1.-clouds.a)*(1.-s.cloudT);
    airL+=airT*s.airL;airT*=s.airT;
}
