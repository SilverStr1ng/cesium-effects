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
void integrateCloud(vec3 d,vec2 segment,inout vec4 acc,inout float weightedDistance){
    if(segment.y<=segment.x)return;
    CloudPhases phases=scatteringPhases(d);
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float span=segment.y-segment.x;
    #ifdef LAYERED_CLOUDS
    cloudRay=d;
    if(cloudLayer==1){
        // Ice is dominated by forward scattering, unlike the liquid dual lobe.
        float cs=dot(d,u_sun),cm=dot(d,u_moon);
        phases.sun=vec3(mix(1./(4.*PI),waterPhase(cs,.82),.85),waterPhase(cs,.35),1./(4.*PI));
        phases.moon=vec3(mix(1./(4.*PI),waterPhase(cm,.82),.85),waterPhase(cm,.35),1./(4.*PI));
    }
    #endif
    float skipUntil=segment.x,skipFootprint=0.;
    int steps=CLOUD_STEPS;
    #ifdef LAYERED_CLOUDS
    if(cloudLayer==1)steps=max(8,int(mix(float(CLOUD_STEPS)*.25,float(CLOUD_STEPS)*.75,smoothstep(20.,120.,span))));
    #endif
    // Quadratic distribution preserves nearby detail on long horizon rays.
    float curve=1.-smoothstep(10.,250.,segment.x);
    for(int i=0;i<CLOUD_STEPS;i++){
        if(i>=steps)break;
        float a=float(i)/float(steps),b=float(i+1)/float(steps);
        float t0=segment.x+mix(a,a*a,curve)*span,t1=segment.x+mix(b,b*b,curve)*span;
        float mid=(t0+t1)*.5,footprint=max(.002,mid*u_pixelAngle);
        #ifdef LAYERED_CLOUDS
        // Filter sub-interval detail as well as the screen pixel footprint.
        // This prevents distant fine erosion from becoming static white specks.
        if(cloudLayer==0&&u_voxelReady)footprint=max(footprint,(t1-t0)/float(CLOUD_SUBSTEPS)*.35);
        if(cloudLayer==0&&u_voxelReady&&u_skipVoxels){
            // A later interval may use a wider mip footprint than the one that
            // established this bound. Shrink the reusable empty range first.
            if(t1<=skipUntil-6.*max(0.,footprint-skipFootprint))continue;
            skipUntil=t0+voxelEmptyDistance(u_camera+d*t0,footprint);skipFootprint=footprint;
            if(t1<=skipUntil)continue;
            // Keep the quadrature of partially occupied intervals unchanged.
            // Only skip entire intervals that have a conservative empty bound.
        }
        #endif
        #ifdef LAYERED_CLOUDS
        // Cirrus filters extinction with the ray derivative in its anisotropic
        // domain. Passing a scalar interval footprint here erased long strands.
        cloudStep=cloudLayer==1?t1-t0:0.;
        #endif
        // Integrate each interval completely: a zero midpoint is not proof that
        // its edges are empty, especially at a sharp cloud silhouette.
        {
            float count=clamp(ceil((t1-t0)/max(.045,footprint)),1.,float(CLOUD_SUBSTEPS));
            #ifdef LAYERED_CLOUDS
            if(cloudLayer==1)count=1.;
            #endif
            float ds=(t1-t0)/count;
            for(int s=0;s<CLOUD_SUBSTEPS;s++){
                if(float(s)>=count)break;
                float offset=jitter;
                // Decorrelate along the ray as well as across pixels: one repeated
                // offset for every interval creates visible contour bands.
                offset=fract(jitter+float(i)*.61803399+float(s)*.41421356);
                #ifdef LAYERED_CLOUDS
                if(cloudLayer==0&&u_voxelReady){
                    // Independent stable samples break curved bands during
                    // close fly-through. A linear interval offset remains too
                    // correlated across the same voxel silhouette.
                    uint hash=uint(gl_FragCoord.x)*1973u+uint(gl_FragCoord.y)*9277u+uint(i*17+s)*26699u;
                    hash=(hash^(hash>>16u))*2246822519u;
                    hash=(hash^(hash>>13u))*3266489917u;hash^=hash>>16u;
                    offset=float(hash&16777215u)/16777216.;
                }
                // The shallow ice medium is smooth and prefiltered; midpoint
                // quadrature avoids projecting screen-space jitter into wisps.
                if(cloudLayer==1)offset=.5;
                #endif
                float t=t0+(float(s)+.05+offset*.9)*ds;
                vec3 p=u_camera+d*t;
                #ifdef LAYERED_CLOUDS
                cloudSlant=1./max(.04,abs(dot(d,normalize(p))));
                #endif
                float rho=cloudDensity(p,footprint,false);
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
    if(depth>0.&&depth<1.){vec4 hit=czm_windowToEyeCoordinates(v_textureCoordinates*czm_viewport.zw+czm_viewport.xy,depth);maximum=atmosphereRayDistance(wc,length(hit.xyz/hit.w));}
    vec2 ground=sphere(u_camera,d,Rg);
    if(ground.x>0.)maximum=min(maximum,ground.x);
    vec4 acc=vec4(0);float weightedDistance=0.;
    #ifdef LAYERED_CLOUDS
    vec2 intervals[4];int layers[4];
    cloudIntervals(u_camera,d,maximum,intervals,layers);
    for(int i=0;i<4;i++){
        cloudLayer=layers[i];integrateCloud(d,intervals[i],acc,weightedDistance);
        if(acc.a>.995)break;
    }
    #else
    vec2 outer=sphere(u_camera,d,Rg+u_base+u_thickness);outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    if(outer.y>outer.x){
        vec2 inner=sphere(u_camera,d,Rg+u_base);
        if(inner.y<=outer.x||inner.x>=outer.y)integrateCloud(d,outer,acc,weightedDistance);
        else{integrateCloud(d,vec2(outer.x,min(outer.y,inner.x)),acc,weightedDistance);if(acc.a<.995)integrateCloud(d,vec2(max(outer.x,inner.y),outer.y),acc,weightedDistance);}
    }
    #endif
    if(u_atmosphere&&acc.a>.0001){
        vec3 airL,airT;integrateAtmosphere(u_camera,d,weightedDistance/acc.a,12,airL,airT);
        acc.rgb=acc.rgb*airT+airL*acc.a;
    }
    // Linear half-float where supported; encoded RGBA8 is the portable fallback.
    out_FragColor=vec4(storeCloudRadiance(acc.rgb),acc.a);
}
