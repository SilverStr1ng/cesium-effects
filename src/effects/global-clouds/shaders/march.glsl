in vec2 v_textureCoordinates;
uniform float u_debugView;
float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;
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
void integrateCloudMedium(vec3 d,vec2 segment,inout vec4 acc,inout float weightedDistance){
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
    // Statistical columns have a smooth cubic profile, so fine voxel quadrature
    // wastes work. Long limb intervals still sample the changing weather field.
    if(cloudLayer==0&&cloudRepresentation==2)steps=min(CLOUD_STEPS,max(16,int(ceil(span/max(.5,(segment.x+segment.y)*.5*u_pixelAngle*.5)))));
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
                debugFootprint=max(debugFootprint,footprint);
                if(cloudLayer==0){
                    if(u_debugView==3.){debugWeather+=cloudWeather(p,footprint).x*ds;debugWeatherLength+=ds;}
                }
                #endif
                float rho=cloudDensity(p,footprint,false);
                if(rho>.001){
                    float alpha=1.-exp(-rho*ds);
                    vec3 light=illumination(p,rho,footprint,phases);
                    float weight=(1.-acc.a)*alpha;
                    acc.rgb+=weight*cloudSource(light);weightedDistance+=weight*t;acc.a+=weight;
                    if(acc.a>.995&&u_debugView==0.)break;
                }
            }
        }
        if(acc.a>.995&&u_debugView==0.)break;
    }
}
void integrateCloud(vec3 d,vec2 segment,inout vec4 acc,inout float weightedDistance){
    if(segment.y<=segment.x)return;
    debugPathLength+=segment.y-segment.x;
    #ifdef LAYERED_CLOUDS
    if(cloudLayer==0&&u_opticsReady){
        float footprint=max(.002,(segment.x+segment.y)*.5*u_pixelAngle);
        float blend=farCloudWeight(footprint);
        vec4 nearCloud=vec4(0),farCloud=vec4(0);float nearDistance=0.,farDistance=0.;
        // One call site also keeps the large march body from being duplicated
        // by ANGLE. The uniform-driven start keeps this tiny loop dynamic.
        for(int mode=blend>=1.?2:1;mode<=2;mode++){
            cloudRepresentation=mode;farAnchor=vec3(1e8);
            vec4 part=vec4(0);float partDistance=0.;integrateCloudMedium(d,segment,part,partDistance);
            if(mode==1){nearCloud=part;nearDistance=partDistance;}else{farCloud=part;farDistance=partDistance;}
            if(blend<=0.)break;
        }
        cloudRepresentation=0;
        // Convex mixture of the same cloud segment, in premultiplied linear L/T.
        // Integrating mixed rho would take a geometric mean of T and add mass.
        vec4 local=mix(nearCloud,farCloud,blend);
        weightedDistance+=(1.-acc.a)*mix(nearDistance,farDistance,blend);
        acc+=local*(1.-acc.a);return;
    }
    #endif
    integrateCloudMedium(d,segment,acc,weightedDistance);
}
void main(){
    vec4 eye=czm_inverseProjection*vec4(v_textureCoordinates*2.-1.,1,1);
    vec3 wc=mat3(czm_inverseView)*normalize(eye.xyz),scaled=wc*vec3(1,1,1.00336409),d=normalize(scaled);
    #ifdef LAYERED_CLOUDS
    cloudScreenRight=mat3(czm_inverseView)*vec3(1,0,0)*vec3(1,1,1.00336409);
    cloudScreenUp=mat3(czm_inverseView)*vec3(0,1,0)*vec3(1,1,1.00336409);
    #endif
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
        if(acc.a>.995&&u_debugView==0.)break;
    }
    #else
    vec2 outer=sphere(u_camera,d,Rg+u_base+u_thickness);outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    if(outer.y>outer.x){
        vec2 inner=sphere(u_camera,d,Rg+u_base);
        if(inner.y<=outer.x||inner.x>=outer.y)integrateCloud(d,outer,acc,weightedDistance);
        else{integrateCloud(d,vec2(outer.x,min(outer.y,inner.x)),acc,weightedDistance);if(acc.a<.995)integrateCloud(d,vec2(max(outer.x,inner.y),outer.y),acc,weightedDistance);}
    }
    #endif
    if(u_debugView>0.){
        float value=0.;vec3 color=vec3(0);
        if(u_debugView==1.)value=log2(1.+debugFootprint)/6.;
        if(u_debugView==3.)value=debugWeather/max(.0001,debugWeatherLength);
        // A mixed segment has no unique microscopic rho. Display its final
        // equivalent extinction (-ln T / clipped cloud-path km), not the max
        // of two underlying fields or their average density.
        if(u_debugView==4.)value=log2(1.-log(max(1e-7,1.-acc.a))/max(.001,debugPathLength))/log2(10.);
        // Effective ray tau after the L/T mixture, including both cloud shells.
        if(u_debugView==5.)value=-log(max(1e-7,1.-acc.a))/16.;
        if(u_debugView==6.){out_FragColor=vec4(vec3(1.-acc.a),1);return;}
        color=clamp(vec3(1.5-abs(4.*value-3.),1.5-abs(4.*value-2.),1.5-abs(4.*value-1.)),0.,1.);
        #ifdef LAYERED_CLOUDS
        if(u_debugView==2.)color=vec3(max(0.,debugMipA)/7.,max(0.,debugMipB)/7.,debugMipA<0.&&debugMipB<0.?1.:0.);
        if(u_debugView==7.)color=vec3(farMoments.a);
        #endif
        if(debugFootprint==0.)color=vec3(0);
        out_FragColor=vec4(color,1);return;
    }
    if(u_atmosphere&&acc.a>.0001){
        vec3 airL,airT;integrateAtmosphere(u_camera,d,weightedDistance/acc.a,12,airL,airT);
        acc.rgb=acc.rgb*airT+airL*acc.a;
    }
    // Linear half-float where supported; encoded RGBA8 is the portable fallback.
    out_FragColor=vec4(storeCloudRadiance(acc.rgb),acc.a);
}
