uniform sampler2D depthTexture;
uniform bool u_atmosphere;
uniform vec3 u_camera,u_moon;
uniform float u_pixelAngle,u_moonFraction;
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
float hg(float c,float g){return (1.-g*g)/pow(max(.01,1.+g*g-2.*g*c),1.5);}
float opticalDepthToSun(vec3 p,float footprint){
    float end=min(32.,max(0.,sphere(p,u_sun,Rg+u_base+u_thickness).y)),tau=0.;
    // Expand the sample cone with distance, integrating the same density field
    // that the camera sees. A 600 km global atlas cannot shadow 1 km cloud lobes.
    vec3 side=normalize(cross(u_sun,abs(u_sun.z)>.9?vec3(1,0,0):vec3(0,0,1))),up=cross(u_sun,side);
    for(int j=0;j<LIGHT_STEPS;j++){
        float a=float(j)/float(LIGHT_STEPS),b=float(j+1)/float(LIGHT_STEPS);
        // Geometric spacing concentrates taps near cloud edges.
        float range=1.+end/.06;
        float t0=.06*(pow(range,a)-1.),t1=.06*(pow(range,b)-1.),t=(t0+t1)*.5,angle=float(j)*2.39996;
        vec3 offset=(side*cos(angle)+up*sin(angle))*t*.025;
        tau+=cloudDensity(p+u_sun*t+offset,max(footprint,t*.02),false)*(t1-t0);
    }
    return tau;
}
vec3 scatteringPhases(vec3 d){
    float c=dot(d,u_sun);vec3 phases;
    float weight=1.,extinction=1.,g=.72;
    for(int order=0;order<3;order++){
        phases[order]=weight*(.85*hg(c,g)+.15*hg(c,-.18*extinction))/(4.*PI);
        weight*=.42;extinction*=.52;g*=.55;
    }
    return phases;
}
vec3 illumination(vec3 p,float rho,float footprint,vec3 phases){
    vec3 vertical=normalize(p);float mu=dot(vertical,u_sun);
    float tau=opticalDepthToSun(p,footprint);
    vec2 ground=sphere(p,u_sun,Rg);
    vec3 solar=vec3(1.);
    if(u_atmosphere)solar=sunTransmission(u_transmittance,p,u_sun);
    if(ground.x>0.&&ground.y>0.)solar=vec3(0);
    // Successive scattering orders broaden the phase and travel farther.
    // All orders retain optical-depth attenuation instead of a constant white fill.
    float direct=dot(phases,exp(-tau*vec3(1.,.52,.2704)));
    float overhead=(cloudDensity(p+vertical*.12,footprint,false)*.24+cloudDensity(p+vertical*.65,max(footprint,.08),false)*1.05);
    vec3 ambient=vec3(.012,.018,.028)*smoothstep(-.18,.12,mu);
    if(u_atmosphere)ambient=decodeL(texture(u_multiple,lutUV(p,u_sun,vec2(32))).rgb)*2.;
    ambient*=exp(-overhead*.65)*.8+.2;
    float height=clamp((length(p)-Rg-u_base)/u_thickness,0.,1.);
    vec3 bounce=solar*max(0.,mu)*.025*(1.-height)*(.3+.7*exp(-rho*.12));
    float moon=max(0.,dot(vertical,u_moon))*u_moonFraction*(1.-smoothstep(-.1,.05,mu));
    return solar*direct*3.+ambient+bounce+vec3(.0004,.0006,.001)*moon;
}
void integrateCloud(vec3 d,vec2 segment,vec3 phases,inout vec4 acc,inout float weightedDistance){
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
                float t=t0+(float(s)+.05+jitter*.9)*ds;
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
    vec2 ground=sphere(u_camera,d,Rg);if(ground.x>0.)maximum=min(maximum,ground.x);
    vec2 outer=sphere(u_camera,d,Rg+u_base+u_thickness);outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    vec4 acc=vec4(0);float weightedDistance=0.;vec3 phases=scatteringPhases(d);
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
