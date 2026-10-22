import {createVoxelCloudField} from './VoxelCloudField';
import {createCloudOptics} from './CloudOptics';
import {createCumulusNoise} from './CumulusNoise';
self.onmessage=()=>{
  try{
    const data=createVoxelCloudField();
    const optics=createCloudOptics(data.bytes,createCumulusNoise().bytes);
    self.postMessage({...data,optics},{transfer:[data.bytes.buffer,optics.buffer,...data.mips.map(level=>level.buffer)]});
  }catch(error){self.postMessage({error:String(error)});}
};
