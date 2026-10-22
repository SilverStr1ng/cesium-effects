// 64 solar-zenith samples x 32 heights x 2 diffuse angular moments, RGBA8.
// Unit solar irradiance, no solar disc. Store E / PI as encoded radiance:
// upper normal and azimuth-averaged horizontal normal. MultipleScattering is
// only a source term inside integrateAtmosphere, never the total sky integral.
#ifndef IRRADIANCE_POLAR_SAMPLES
#define IRRADIANCE_POLAR_SAMPLES 32
#endif
#ifndef IRRADIANCE_AZIMUTH_SAMPLES
#define IRRADIANCE_AZIMUTH_SAMPLES 8
#endif
#ifndef IRRADIANCE_RAY_STEPS
#define IRRADIANCE_RAY_STEPS 24
#endif
vec3 integrateSkyIrradiance(float height,float sunMu,bool side){
    vec3 p=vec3(0,0,Rg+max(.001,height));
    vec3 sun=vec3(sqrt(max(0.,1.-sunMu*sunMu)),0,sunMu),irradiance=vec3(0);
    // Midpoint angular quadrature. The same physical-horizon warp as SkyView
    // resolves the narrow bright limb; its Jacobian preserves solid angle.
    float horizon=skyHorizonAngle(length(p));
    for(int y=0;y<IRRADIANCE_POLAR_SAMPLES;y++){
        float v=(float(y)+.5)/float(IRRADIANCE_POLAR_SAMPLES);
        float jacobian=v<.5?4.*horizon*(1.-2.*v):4.*(PI-horizon)*(2.*v-1.);
        for(int x=0;x<IRRADIANCE_AZIMUTH_SAMPLES;x++){
            // Spherical transport is symmetric about the sun/up plane. Sample
            // one azimuth half and account for both with the 2 PI weight below.
            vec3 d=skyViewDirection(vec2(.5*(float(x)+.5)/float(IRRADIANCE_AZIMUTH_SAMPLES),v),length(p));
            vec3 L,T;integrateAtmosphereWithSun(p,d,1e6,IRRADIANCE_RAY_STEPS,sun,L,T);
            float sinTheta=sqrt(max(0.,1.-d.z*d.z));
            // The azimuth average of max(dot(horizontalNormal,d),0) is sin/PI.
            float cosine=side?sinTheta/PI:max(0.,d.z);
            irradiance+=L*(2.*sinTheta*jacobian*cosine);
        }
    }
    return irradiance/float(IRRADIANCE_POLAR_SAMPLES*IRRADIANCE_AZIMUTH_SAMPLES);
}
void main(){
    vec2 uv=vec2((gl_FragCoord.x-.5)/63.,(mod(gl_FragCoord.y-.5,32.))/31.);
    float signedMu=uv.x*2.-1.,sunMu=sign(signedMu)*signedMu*signedMu;
    // Scale only the storage encoding (not the light): resolve faint twilight
    // below one RGB8 square-root quantum; sampling divides by exactly 16.
    out_FragColor=vec4(encodeL(16.*integrateSkyIrradiance(uv.y*uv.y*(Rt-Rg),sunMu,gl_FragCoord.y>=32.)),1);
}
