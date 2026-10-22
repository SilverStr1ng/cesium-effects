uniform sampler2D colorTexture,depthTexture,u_clouds;
in vec2 v_textureCoordinates;
float distanceAt(vec2 uv){float depth=texture(depthTexture,uv).r;if(depth<=0.||depth>=1.)return 1e10;vec4 p=czm_windowToEyeCoordinates(uv*czm_viewport.zw+czm_viewport.xy,depth);return length(p.xyz/p.w);}
void main(){
    vec2 size=vec2(textureSize(u_clouds,0)),p=v_textureCoordinates*size-.5,base=floor(p),f=fract(p);
    float center=distanceAt(v_textureCoordinates),sum=0.;vec4 clouds=vec4(0);
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
        vec2 uv=(base+vec2(x,y)+.5)/size;
        float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
        weight*=exp(-abs(distanceAt(uv)-center)/max(20.,center*.01));
        vec4 sampleCloud=texture(u_clouds,uv);sampleCloud.rgb=decodeL(sampleCloud.rgb);
        clouds+=sampleCloud*weight;sum+=weight;
    }
    if(sum>.0001)clouds/=sum;else{clouds=texture(u_clouds,v_textureCoordinates);clouds.rgb=decodeL(clouds.rgb);}
    vec3 background=texture(colorTexture,v_textureCoordinates).rgb;
    out_FragColor=vec4(cloudDisplay(clouds.rgb+cloudBackground(background)*(1.-clouds.a)),1);
}
