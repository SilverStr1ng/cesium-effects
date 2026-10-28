import {createCumulusNoise} from '../src/effects/global-clouds/CumulusNoise';
import {createVoxelCloudField,sampleVolume} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOpticsData,CLOUD_COMPONENTS} from '../src/effects/global-clouds/CloudOptics';
import {writeFileSync} from 'node:fs';
const noise=createCumulusNoise().bytes,voxels=createVoxelCloudField().bytes,rows=[];
for(const [detail,thickness] of [[.55,3.8],[0,3.8],[1,3.8],[.55,1],[.55,8]]){
  const {optics,components}=createCloudOpticsData(voxels,noise,{detail,thickness});
  const component=(cut:number,type:number,k:number,c:number)=>{
    const x=cut/.52*31,y=type*31,a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b;
    const at=(i:number,j:number)=>components[(Math.min(31,i)+32*(Math.min(31,j)+32*k))*4+c]/255;
    return (at(a,b)*(1-fx)+at(a+1,b)*fx)*(1-fy)+(at(a,b+1)*(1-fx)+at(a+1,b+1)*fx)*fy;
  };
  for(const cut of [0,.1,.25,.5])for(const type of [.45,.75,1])for(const scale of [.03125,.1,.3125,1.1,3,10,25,100]){
    const reference=sampleVolume(optics,32,cut/.52*31,type*31,(Math.log2(scale)+5)/12*31,0);
    let opacity=0;for(let k=0;k<CLOUD_COMPONENTS;k++){
      const tau=Math.expm1((component(cut,type,k,0)*65280+component(cut,type,k,1)*255)/65535*Math.log(65));
      opacity+=component(cut,type,k,2)*255/256*-Math.expm1(-tau*scale);
    }
    rows.push({detail,thickness,cut,type,scale,opacity,reference,error:opacity-reference});
  }
}
const failures=rows.filter(r=>Math.abs(r.error)>.02),report={passed:failures.length===0,maxError:Math.max(...rows.map(r=>Math.abs(r.error))),failures,rows};
writeFileSync('artifacts/stage6/components-cpu.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,maxError:report.maxError,failures},null,2));
if(failures.length)process.exitCode=1;
