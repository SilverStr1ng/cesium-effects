// Disjoint spherical layers can yield four segments on a limb ray. Never sort
// only by camera altitude: near/far crossings of each shell must interleave.
void shellIntervals(vec3 origin,vec3 d,float maximum,float base,float thickness,out vec2 nearPart,out vec2 farPart){
    nearPart=vec2(1e9);farPart=vec2(1e9);
    vec2 outer=sphere(origin,d,Rg+base+thickness);
    outer=vec2(max(0.,outer.x),min(maximum,outer.y));
    if(outer.y<=outer.x)return;
    vec2 inner=sphere(origin,d,Rg+base);
    if(inner.y<=outer.x||inner.x>=outer.y){nearPart=outer;return;}
    vec2 a=vec2(outer.x,min(outer.y,inner.x)),b=vec2(max(outer.x,inner.y),outer.y);
    if(a.y>a.x)nearPart=a;
    if(b.y>b.x)farPart=b;
}
void cloudIntervals(vec3 origin,vec3 d,float maximum,out vec2 intervals[4],out int layers[4]){
    vec2 ground=sphere(origin,d,Rg);
    if(ground.x>0.)maximum=min(maximum,ground.x);
    shellIntervals(origin,d,maximum,u_base,u_thickness,intervals[0],intervals[1]);
    intervals[2]=vec2(1e9);intervals[3]=vec2(1e9);
    if(u_highCoverage>0.)shellIntervals(origin,d,maximum,u_highBase,u_highThickness,intervals[2],intervals[3]);
    layers[0]=0;layers[1]=0;layers[2]=1;layers[3]=1;
    for(int i=1;i<4;i++)for(int j=0;j<3;j++){
        if(j>=4-i)break;
        if(intervals[j].x>intervals[j+1].x){
            vec2 temp=intervals[j];intervals[j]=intervals[j+1];intervals[j+1]=temp;
            int layer=layers[j];layers[j]=layers[j+1];layers[j+1]=layer;
        }
    }
}
