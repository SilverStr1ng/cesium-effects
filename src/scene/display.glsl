// Shared scene-referred display mapping. Atmosphere and clouds must use the same
// curve; applying a different curve to a premultiplied cloud creates dark fringes.
vec3 displayRadiance(vec3 radiance,float exposure){
    vec3 x=max(radiance*exposure,vec3(0));
    vec3 mapped=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);
    return pow(mapped,vec3(1./2.2));
}
vec3 recoverRadiance(vec3 display,float exposure){
    // Positive root of the ACES fitted curve. Display-clipped highlights cannot
    // be recovered, but non-clipped backgrounds round-trip through cloud resolve.
    vec3 y=pow(clamp(display,0.,1.),vec3(2.2));
    vec3 a=2.51-2.43*y,b=.59*y-.03;
    return (b+sqrt(b*b+.56*y*a))/(2.*a*max(exposure,.0001));
}
