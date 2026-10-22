vec3 storeCloudRadiance(vec3 radiance){
    #ifdef CLOUD_HDR
    return radiance;
    #else
    return encodeL(radiance);
    #endif
}
vec3 loadCloudRadiance(vec3 texel){
    #ifdef CLOUD_HDR
    return texel;
    #else
    return decodeL(texel);
    #endif
}
