#ifdef CLOUD_RUNTIME_STORAGE
uniform bool u_cloudHdr;
#endif
vec3 storeCloudRadiance(vec3 radiance){
    #ifdef CLOUD_RUNTIME_STORAGE
    return u_cloudHdr?radiance:encodeL(radiance);
    #elif defined(CLOUD_HDR)
    return radiance;
    #else
    return encodeL(radiance);
    #endif
}
vec3 loadCloudRadiance(vec3 texel){
    #ifdef CLOUD_RUNTIME_STORAGE
    return u_cloudHdr?texel:decodeL(texel);
    #elif defined(CLOUD_HDR)
    return texel;
    #else
    return decodeL(texel);
    #endif
}
