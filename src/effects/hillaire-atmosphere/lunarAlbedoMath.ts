export const srgbToLinear=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;

/** NASA's display-referred sRGB map is a relative reflectance pattern, not an
 * absolute calibrated albedo. Decode BEFORE filtering; normalize by spherical
 * area mean at shading time, so display brightness stays an independent gain. */
export function linearLunarAlbedo(rgba:Uint8ClampedArray,width:number,height:number){
  const table=Uint8Array.from({length:256},(_,i)=>Math.round(255*srgbToLinear(i/255)));
  const bytes=new Uint8Array(rgba.length);let sum=0,weightSum=0;
  for(let y=0;y<height;y++){
    const weight=Math.sin(Math.PI*(y+.5)/height);weightSum+=weight*width;
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      for(let c=0;c<3;c++)bytes[i+c]=table[rgba[i+c]];
      bytes[i+3]=255;sum+=weight*(.2126*bytes[i]+.7152*bytes[i+1]+.0722*bytes[i+2])/255;
    }
  }
  return {bytes,mean:sum/weightSum};
}

/** CPU mirror of the map convention, for landmark / seam / pole tests. The
 * upload is not flipped: texture row zero is the northern edge of the JPEG. */
export function lunarMapUV(normal:readonly number[]){
  const [x,y,z]=normal,r=Math.hypot(x,y,z);
  return [.5+Math.atan2(y,x)/(2*Math.PI),.5-Math.asin(Math.max(-1,Math.min(1,z/r)))/Math.PI];
}
