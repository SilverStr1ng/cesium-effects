in vec2 v_textureCoordinates;
float sceneDepth(vec2 uv){
    // A reduced-resolution ray rarely hits the exact centre of a full-resolution
    // depth texel. Nearest depth at a different ray cuts holes in orbital clouds.
    vec2 size=vec2(textureSize(depthTexture,0)),pixel=uv*size-.5,base=floor(pixel),f=fract(pixel);
    vec4 z=vec4(texture(depthTexture,(base+vec2(.5,.5))/size).r,
        texture(depthTexture,(base+vec2(1.5,.5))/size).r,
        texture(depthTexture,(base+vec2(.5,1.5))/size).r,
        texture(depthTexture,(base+vec2(1.5,1.5))/size).r);
    float lo=min(min(z.x,z.y),min(z.z,z.w)),hi=max(max(z.x,z.y),max(z.z,z.w));
    if(lo<=0.||hi>=1.||hi-lo>.002)return texture(depthTexture,uv).r;
    return mix(mix(z.x,z.y,f.x),mix(z.z,z.w,f.x),f.y);
}
void integrateCloud(vec3 d,vec2 segment,CloudPhases phases,inout vec4 acc,inout float weightedDistance){
    if(segment.y<=segment.x)return;
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float span=segment.y-segment.x;
    // Quadratic distribution preserves nearby detail on long horizon rays.
    float curve=1.-smoothstep(10.,250.,segment.x);
    for(int i=0;i<CLOUD_STEPS;i++){
        float a=float(i)/float(CLOUD_STEPS),b=float(i+1)/float(CLOUD_STEPS);
        float t0=segment.x+mix(a,a*a,curve)*span,t1=segment.x+mix(b,b*b,curve)*span;
        float mid=(t0+t1)*.5,footprint=max(.002,mid*u_pixelAngle);
        // Integrate each interval completely: a zero midpoint is not proof that
        // its edges are empty, especially at a sharp cloud silhouette.
        {
            float count=clamp(ceil((t1-t0)/max(.045,footprint)),1.,float(CLOUD_SUBSTEPS));
            float ds=(t1-t0)/count;
            for(int s=0;s<CLOUD_SUBSTEPS;s++){
                if(float(s)>=count)break;
                float offset=jitter;
                #ifdef WATER_CLOUDS
                // Decorrelate along the ray as well as across pixels: one repeated
                // offset for every interval creates visible contour bands.
                offset=fract(jitter+float(i)*.61803399+float(s)*.41421356);
                #endif
                float t=t0+(float(s)+.05+offset*.9)*ds;
                vec3 p=u_camera+d*t;float rho=cloudDensity(p,footprint,false);
                if(rho>.001){
                    float alpha=1.-exp(-rho*ds);
                    vec3 light=illumination(p,rho,footprint,phases);
                    float weight=(1.-acc.a)*alpha;
                    acc.rgb+=weight*cloudSource(light);weightedDistance+=weight*t;acc.a+=weight;
                    if(acc.a>.995)break;
                }
            }
        }
        if(acc.a>.995)break;
    }
}
void main(){
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    vec3 wc=mat3(czm_inverseView)*normalize(eye.xyz),scaled=wc*vec3(1,1,1.00336409),d=normalize(scaled);
    float maximum=1e8,depth=sceneDepth(v_textureCoordinates);
    if(depth>0.&&depth<1.){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=length(hit.xyz/hit.w)*.001*length(scaled);}
    vec2 ground=sphere(u_camera,d,Rg);
    if(ground.x>0.)maximum=min(maximum,ground.x);
    vec2 outer=sphere(u_camera,d,Rg+u_base+u_thickness);outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    vec4 acc=vec4(0);float weightedDistance=0.;CloudPhases phases=scatteringPhases(d);
    if(outer.y>outer.x){
        vec2 inner=sphere(u_camera,d,Rg+u_base);
        if(inner.y<=outer.x||inner.x>=outer.y)integrateCloud(d,outer,phases,acc,weightedDistance);
        else{integrateCloud(d,vec2(outer.x,min(outer.y,inner.x)),phases,acc,weightedDistance);if(acc.a<.995)integrateCloud(d,vec2(max(outer.x,inner.y),outer.y),phases,acc,weightedDistance);}
    }
    if(u_atmosphere&&acc.a>.0001){
        vec3 airL,airT;integrateAtmosphere(u_camera,d,weightedDistance/acc.a,12,airL,airT);
        acc.rgb=acc.rgb*airT+airL*acc.a;
    }
    // RGBA8 stores encoded linear radiance. Decode each texel before filtering.
    out_FragColor=vec4(encodeL(acc.rgb),acc.a);
}
