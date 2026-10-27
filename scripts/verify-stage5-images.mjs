import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
const root='artifacts/stage5/',results=[];
for(const name of readdirSync(root).filter(n=>/^(current|baseline)-.*\.png$/.test(n))){
 const b=readFileSync(root+name);let pos=8,end=false,idat=[],width=0,height=0,color=0,depth=0;
 if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(name+' signature');
 while(pos+12<=b.length){const n=b.readUInt32BE(pos),type=b.toString('ascii',pos+4,pos+8);if(pos+n+12>b.length)throw Error(name+' truncated chunk');
 if(type==='IHDR'){width=b.readUInt32BE(pos+8);height=b.readUInt32BE(pos+12);depth=b[pos+16];color=b[pos+17];}
 if(type==='IDAT')idat.push(b.subarray(pos+8,pos+8+n));pos+=n+12;if(type==='IEND'){end=true;break;}}
 if(!end||pos!==b.length)throw Error(name+' incomplete IEND');
 const raw=inflateSync(Buffer.concat(idat)),channels=color===6?4:color===2?3:0;
 if(depth!==8||!channels||raw.length!==(width*channels+1)*height)throw Error(name+' invalid decoded pixels');
 results.push({name,width,height,bytes:b.length,decodedBytes:raw.length});
}
writeFileSync(root+'png-validation.json',JSON.stringify({passed:true,count:results.length,results},null,2));console.log('Complete PNGs: '+results.length);
