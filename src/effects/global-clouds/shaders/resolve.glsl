uniform sampler2D colorTexture,depthTexture,u_clouds,u_skyRadiance;
uniform bool u_hasSkyRadiance,u_skyRadianceHdr;
uniform bool u_emptySceneDepth;
uniform float u_debugView;
in vec2 v_textureCoordinates;
float distanceAt(vec2 uv){if(u_emptySceneDepth)return 1e10;float depth=texture(depthTexture,uv).r;if(depth<=0.||depth>=1.)return 1e10;vec4 p=czm_windowToEyeCoordinates(uv*czm_viewport.zw+czm_viewport.xy,depth);return length(p.xyz/p.w);}
void main(){
    if(u_debugView>0.){out_FragColor=vec4(texture(u_clouds,v_textureCoordinates).rgb,1);return;}
    vec2 size=vec2(textureSize(u_clouds,0)),p=v_textureCoordinates*size,base=floor(p);
    vec4 reference=texture(u_clouds,(base+.5)/size);
    vec3 referenceMetric=encodeL(loadCloudRadiance(reference.rgb));
    float center=distanceAt(v_textureCoordinates),sum=0.;vec4 clouds=vec4(0);
    // Small bilateral reconstruction suppresses spatial march noise without
    // averaging across terrain, cloud silhouettes or large lighting changes.
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
        vec2 uv=(base+vec2(x,y)+.5)/size;
        vec2 delta=uv*size-p;
        float weight=exp(-dot(delta,delta)/.85);
        weight*=exp(-abs(distanceAt(uv)-center)/max(20.,center*.01));
        vec4 sampleCloud=texture(u_clouds,uv);
        sampleCloud.rgb=loadCloudRadiance(sampleCloud.rgb);
        vec3 colorDelta=encodeL(sampleCloud.rgb)-referenceMetric;
        weight*=exp(-abs(sampleCloud.a-reference.a)*8.-dot(colorDelta,colorDelta)/.012);
        clouds+=sampleCloud*weight;sum+=weight;
    }
    if(sum>.0001)clouds/=sum;else{clouds=texture(u_clouds,v_textureCoordinates);clouds.rgb=loadCloudRadiance(clouds.rgb);}
    vec3 background=texture(colorTexture,v_textureCoordinates).rgb;
    vec3 linearBackground;
    if(u_hasSkyRadiance){
        vec3 stored=texture(u_skyRadiance,v_textureCoordinates).rgb;
        linearBackground=u_skyRadianceHdr?stored:decodeL(stored);
    }else linearBackground=cloudBackground(background);
    out_FragColor=vec4(cloudDisplay(clouds.rgb+linearBackground*(1.-clouds.a)),1);
}
