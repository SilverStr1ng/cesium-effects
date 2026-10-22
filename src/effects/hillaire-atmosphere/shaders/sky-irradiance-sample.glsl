// Cache values are E/PI for a unit-irradiance sun. Local radius and the dot
// product of the local radial normal and sun are the only coordinates.
// Separate texel-center ranges prevent bilinear leakage between the two bands.
void sampleSkyIrradiance(sampler2D lut,vec3 p,vec3 sun,out vec3 sky,out vec3 horizon){
    float mu=clamp(dot(normalize(p),sun),-1.,1.);
    vec2 uv=vec2(.5+.5*sign(mu)*sqrt(abs(mu)),sqrt(clamp((length(p)-Rg)/(Rt-Rg),0.,1.)));
    uv=(uv*vec2(63,31)+.5)/vec2(64,64);
    sky=decodeL(texture(lut,uv).rgb)/16.;
    horizon=decodeL(texture(lut,uv+vec2(0,.5)).rgb)/16.;
}
