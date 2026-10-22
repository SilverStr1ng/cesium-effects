import {createVoxelCloudField} from './VoxelCloudField';
self.onmessage=()=>{
  try{
    const data=createVoxelCloudField();
    self.postMessage(data,{transfer:[data.bytes.buffer,...data.mips.map(level=>level.buffer)]});
  }catch(error){self.postMessage({error:String(error)});}
};
