import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

// Evidence integrity only. Decodable PNGs do not establish visual acceptance.
const root='artifacts/stage7/data/',rows=[];
for(const name of readdirSync(root).filter(n=>/^(before|after)-.*\.png$/.test(n))){
  const data=readFileSync(root+name);let position=8,ended=false,width=0,height=0,depth=0,color=0;
  const blocks=[];
  if(data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(name+': PNG signature');
  while(position+12<=data.length){
    const size=data.readUInt32BE(position),type=data.toString('ascii',position+4,position+8);
    if(position+size+12>data.length)throw Error(name+': truncated chunk');
    if(type==='IHDR'){width=data.readUInt32BE(position+8);height=data.readUInt32BE(position+12);depth=data[position+16];color=data[position+17];}
    if(type==='IDAT')blocks.push(data.subarray(position+8,position+8+size));
    position+=size+12;if(type==='IEND'){ended=true;break;}
  }
  if(!ended||position!==data.length)throw Error(name+': missing IEND');
  const pixels=inflateSync(Buffer.concat(blocks)),channels=color===6?4:color===2?3:0;
  if(depth!==8||!channels||pixels.length!==(width*channels+1)*height)throw Error(name+': invalid pixel stream');
  rows.push({name,width,height,bytes:data.length});
}
writeFileSync(root+'png-validation.json',JSON.stringify({passed:true,visualAcceptance:false,count:rows.length,rows},null,2));
console.log(`${rows.length} complete PNG streams; visual review is separate`);
