import {cloudProbe} from './cloudProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import cloudTransport from '../src/effects/global-clouds/shaders/transport.glsl?raw';

const output=document.querySelector('#result')!;
const gpu=cloudProbe(document.querySelector('canvas')!);
try{
  const column=`void main(){float i=floor(gl_FragCoord.x);float z=1.-2.*(i+.5)/128.,phi=i*2.39996323;
    vec3 n=vec3(sqrt(1.-z*z)*cos(phi),sqrt(1.-z*z)*sin(phi),z);cloudLayer=1;cloudRay=-n;
    float tau=0.,ds=u_highThickness/128.;for(int j=0;j<128;j++)tau+=highCloudDensity(n*(Rg+u_highBase+(float(j)+.5)*ds),.02)*ds;
    out_FragColor=vec4(tau,exp(-tau),0,1);}`;
  const columns=[.5,1.5,3].map(thickness=>{
    const {pixels}=gpu.draw(common+density+voxel+column,128,1,{...gpu.uniforms,u_highCoverage:.7,u_highThickness:thickness,u_highOpticalDepth:.18},gpu.inputs,true);
    return Array.from(pixels).filter((_,i)=>i%4===0);
  });
  let relativeError=0,absoluteError=0;for(let i=0;i<128;i++){absoluteError=Math.max(absoluteError,Math.abs(columns[2][i]-columns[0][i]));if(columns[1][i]>.0001)relativeError=Math.max(relativeError,Math.abs(columns[2][i]-columns[0][i])/columns[1][i]);}
  // Float32 reprojection of a 6378 km position shifts very thin fibre edges;
  // bound the absolute tau error relative to the requested column parameter.
  const checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
  // Separate the profile law from sub-metre Float32 shifts at fibre edges.
  const white=gpu.draw('void main(){out_FragColor=vec4(1);}',1,1).texture;
  const solid=gpu.gl.createTexture()!;gpu.gl.bindTexture(gpu.gl.TEXTURE_3D,solid);
  gpu.gl.texImage3D(gpu.gl.TEXTURE_3D,0,gpu.gl.RGBA8,1,1,1,0,gpu.gl.RGBA,gpu.gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  gpu.gl.texParameteri(gpu.gl.TEXTURE_3D,gpu.gl.TEXTURE_MIN_FILTER,gpu.gl.LINEAR);gpu.gl.texParameteri(gpu.gl.TEXTURE_3D,gpu.gl.TEXTURE_MAG_FILTER,gpu.gl.LINEAR);
  let normalizedError=0;
  for(const thickness of [.5,1.5,3]){
    const data=gpu.draw(common+density+voxel+column,128,1,{...gpu.uniforms,u_highType:1,u_highCoverage:1,u_highThickness:thickness,u_highOpticalDepth:.18},
      {...gpu.inputs,u_weather:white,u_cirrus:{texture:solid,target:gpu.gl.TEXTURE_3D}},true).pixels;
    for(let i=0;i<128;i++)normalizedError=Math.max(normalizedError,Math.abs(data[i*4]-.18));
  }
  gpu.gl.deleteTexture(solid);
  checks.push({name:'tau_v is the actual normalized vertical column depth independent of shell thickness',pass:normalizedError<.0001,maximumTauError:normalizedError},
    {name:'full procedural columns stay within the Float32 world-position error budget as thickness changes',pass:absoluteError<.002,maximumTauError:absoluteError,maximumRelativeErrorAtThinEdges:relativeError});
  const source=common+density+voxel;
  const run=(main:string,width=128,uniforms:Record<string,number|number[]|boolean>={})=>gpu.draw(source+main,width,1,{...gpu.uniforms,u_highCoverage:.65,...uniforms},gpu.inputs,true).pixels;
  const profiles=run(`void main(){float h=(gl_FragCoord.x-.5)/127.;out_FragColor=vec4(highProfile(h),0,0,1);}`);
  let profileIntegral=0;for(let i=0;i<128;i++)profileIntegral+=profiles[i*4]/127;
  checks.push({name:'unit-integral vertical profile including zero shell boundaries',pass:Math.abs(profileIntegral-1)<1e-5&&profiles[0]===0&&profiles[127*4]===0,profileIntegral});
  const limb=run(`void main(){float h=mix(-1.,u_highThickness-.001,(gl_FragCoord.x-.5)/127.);vec3 origin=vec3(-1000,0,Rg+u_highBase+h),d=vec3(1,0,0);
    vec2 path=sphere(origin,d,Rg+u_highBase+u_highThickness),inner=sphere(origin,d,Rg+u_highBase);
    if(inner.x>path.x&&inner.y>inner.x)path.y=inner.x;
    float coarse=highProfilePath(origin,d,path),reference=0.,ds=(path.y-path.x)/2048.;
    for(int j=0;j<2048;j++)reference+=highProfile((length(origin+d*(path.x+(float(j)+.5)*ds))-Rg-u_highBase)/u_highThickness)*ds/u_highThickness;
    out_FragColor=vec4(coarse,reference,exp(-coarse*.1),1);}`);
  let limbError=0,maxPath=0;for(let i=0;i<128;i++){limbError=Math.max(limbError,Math.abs(Math.exp(-limb[i*4]*.1)-Math.exp(-limb[i*4+1]*.1)));maxPath=Math.max(maxPath,limb[i*4]);}
  checks.push({name:'finite limb optical path matches 2048-step spherical reference',pass:limbError<.01&&Number.isFinite(maxPath)&&limb[127*4]<limb[64*4],maxTransmissionError:limbError,maxProfilePath:maxPath});
  const continuity=run(`void main(){float i=floor(gl_FragCoord.x),side=mod(i,2.)*2.-1.,j=floor(i/2.);
    float lon=side*PI,lat=mix(-PI*.5,PI*.5,j/63.);vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
    vec3 uv;mat3 J;float regular;highDomain(n*(Rg+u_highBase),uv,J,regular);out_FragColor=vec4(highCloudDensity(n*(Rg+u_highBase+.6),.02),regular,0,1);}`);
  let seamError=0;for(let i=0;i<64;i++)for(let c=0;c<3;c++)seamError=Math.max(seamError,Math.abs(continuity[i*8+c]-continuity[i*8+4+c]));
  checks.push({name:'material and wind regularization remain continuous at dateline and both poles',pass:seamError<.001,seamError});
  const directional=run(`void main(){float i=floor(gl_FragCoord.x),z=1.-2.*(i+.5)/128.,phi=i*2.39996323;vec3 n=vec3(sqrt(1.-z*z)*cos(phi),sqrt(1.-z*z)*sin(phi),z),p=n*(Rg+u_highBase+.6);
    vec3 uv;mat3 J;float regular;highDomain(p,uv,J,regular);vec3 across=normalize(vec3(J[0][0],J[1][0],J[2][0])),along=normalize(cross(n,across));
    float center=highCloudDensity(p,.002),a=highCloudDensity(normalize(p+along*.12)*length(p),.002),b=highCloudDensity(normalize(p+across*.12)*length(p),.002);
    out_FragColor=vec4(abs(a-center),abs(b-center),regular,1);}`);
  let along=0,across=0;for(let i=0;i<128;i++){along+=directional[i*4];across+=directional[i*4+1];}
  checks.push({name:'resolved cirrus follows the position-dependent wind instead of a fixed world axis',pass:across>along*3,alongVariation:along/128,acrossVariation:across/128});
  const stagnation=run(`void main(){float s=mod(floor(gl_FragCoord.x),2.)*2.-1.;vec3 n=normalize(vec3(.17,.41,.896));
    for(int j=0;j<160;j++){vec3 uv;mat3 J;float r;highDomain(n*(Rg+u_highBase),uv,J,r);vec3 g=vec3(J[0][0],J[1][0],J[2][0]);n=normalize(n+g*.3);}
    n=normalize(n+vec3(s*1e-7,0,0));vec3 p=n*(Rg+u_highBase+.6),uv;mat3 J;float regular;highDomain(p,uv,J,regular);out_FragColor=vec4(highCloudDensity(p,.02),regular,0,1);}`,2);
  checks.push({name:'stagnation points have finite continuous material without a normalized zero direction',pass:stagnation.every(Number.isFinite)&&Math.abs(stagnation[0]-stagnation[4])<.001&&stagnation[1]<.1,values:Array.from(stagnation)});

  // Production transport, with a supersampled column reference in linear L/T.
  const header='#define LAYERED_CLOUDS\n#define LIGHT_STEPS 5\n#define CLOUD_STEPS 64\n#define CLOUD_SUBSTEPS 3\n'+common+transport+density+voxel+
    'vec3 u_camera;uniform vec3 u_moon;uniform bool u_atmosphere;uniform float u_moonFraction,u_moonGain,u_pixelAngle,u_debugView;float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;struct CloudPhases{vec3 sun;vec3 moon;};'+environment+lighting+
    'vec3 cloudSource(vec3 light){return light;}'+cloudTransport+march.slice(march.indexOf('CloudSegment integrateCloud'),march.indexOf('void main()'));
  const main=`uniform float u_grid,u_footprint,u_reference;void main(){
    float patchIndex=floor((gl_FragCoord.x-.5)/u_grid),lon=-1.7+patchIndex*.37,lat=.45+sin(patchIndex*1.7)*.6;
    vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
    vec2 offset=(vec2(mod(gl_FragCoord.x-.5,u_grid),gl_FragCoord.y-.5)+.5)/u_grid-.5;
    n=normalize(n*Rg+(east*offset.x+north*offset.y)*u_footprint);cloudScreenRight=east;cloudScreenUp=north;cloudRay=-n;cloudLayer=1;
    u_camera=n*(Rg+u_highBase+u_highThickness+17000.);
    if(u_reference<.5){CloudSegment s=integrateCloud(-n,vec2(17000.,17000.+u_highThickness));out_FragColor=vec4(s.L,s.cloudT);return;}
    CloudPhases phases=scatteringPhases(-n);vec3 L=vec3(0);float T=1.,ds=u_highThickness/48.;
    for(int j=0;j<48;j++){vec3 p=n*(Rg+u_highBase+u_highThickness-(float(j)+.5)*ds);float rho=highCloudDensity(p,.002),a=1.-exp(-rho*ds);
      if(rho>0.)L+=T*a*illumination(p,rho,.002,phases);T*=1.-a;}out_FragColor=vec4(L,T);}`;
  const uniforms={...gpu.uniforms,u_highCoverage:.65,u_sun:[-.2,-.8,.5656854],u_moon:[0,0,-1],u_atmosphere:false,u_moonFraction:0,u_moonGain:0};
  const inputs={...gpu.inputs,u_transmittance:gpu.inputs.u_weather,u_multiple:gpu.inputs.u_weather,u_skyIrradiance:gpu.inputs.u_weather};
  const comparisons=[0,1].flatMap(type=>[.02,.8,27.96283355].map(fp=>{
    const grid=64,reference=gpu.draw(header+main,grid*8,grid,{...uniforms,u_highType:type,u_grid:grid,u_footprint:fp,u_reference:1},inputs,true).pixels;
    const actual=gpu.draw(header+main,8,1,{...uniforms,u_highType:type,u_grid:1,u_footprint:fp,u_pixelAngle:fp/17000.75,u_reference:0},inputs,true).pixels;
    let maxTError=0,maxLError=0,meanT=0;const referenceLT:number[][]=[];
    for(let patch=0;patch<8;patch++){const mean=[0,0,0,0];for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)for(let c=0;c<4;c++)mean[c]+=reference[(y*grid*8+patch*grid+x)*4+c]/grid**2;
      referenceLT.push(mean);maxTError=Math.max(maxTError,Math.abs(actual[patch*4+3]-mean[3]));maxLError=Math.max(maxLError,Math.hypot(...mean.slice(0,3).map((v,c)=>v-actual[patch*4+c])));meanT+=mean[3]/8;}
    return {type,footprintKm:fp,maxTError,maxLError,meanReferenceT:meanT,referenceLT};
  }));
  checks.push({name:'both ice presets preserve downsampled linear radiance/transmission from ground to satellite',pass:comparisons.every(c=>c.maxTError<.04&&c.maxLError<.025),comparisons});
  const convergence=[0,1].map(type=>{
    const grid=128,fp=27.96283355,data=gpu.draw(header+main,grid*8,grid,{...uniforms,u_highType:type,u_grid:grid,u_footprint:fp,u_reference:1},inputs,true).pixels;
    let maxMeanDelta=0;for(let patch=0;patch<8;patch++)for(let c=0;c<4;c++){
      let mean=0;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)mean+=data[(y*grid*8+patch*grid+x)*4+c]/grid**2;
      maxMeanDelta=Math.max(maxMeanDelta,Math.abs(mean-comparisons[type*3+2].referenceLT[patch][c]));
    }return {type,maxMeanDelta};
  });
  checks.push({name:'satellite supersampling reference converges from 64 squared to 128 squared subrays',pass:convergence.every(c=>c.maxMeanDelta<.01),convergence});
  const endpoints=[.0799,.0801,.7999,.8001].map(fp=>gpu.draw(header+main,8,1,{...uniforms,u_grid:1,u_footprint:fp,u_pixelAngle:fp/17000.75,u_reference:0},inputs,true).pixels);
  let endpointError=0;for(const pair of [0,2])for(let i=0;i<32;i++)endpointError=Math.max(endpointError,Math.abs(endpoints[pair][i]-endpoints[pair+1][i]));
  checks.push({name:'resolved/statistical ice blends completed L/T continuously at both footprint endpoints',pass:endpointError<.005,maximumLTDelta:endpointError});

  // Colored homogeneous air plus two differently colored cloud segments. The
  // exact piecewise solution includes air inside each cloud and clear gaps.
  const airFixture=common+cloudTransport+`void main(){
    vec3 j=vec3(.002,.006,.012),e=vec3(.01,.04,.1),background=vec3(2,1,.4);
    CloudSegment clear=emptyCloudSegment(),physical=emptyCloudSegment();vec4 clouds=vec4(0);vec3 prefixL=vec3(0),prefixT=vec3(1);
    for(int i=0;i<5;i++){
      float ds=i==0?4.:i==1?7.:i==2?11.:i==3?19.:5.;float rho=i==1?.17:i==3?.025:0.;vec3 S=i==1?vec3(.8,.2,.1):vec3(.1,.6,1.);
      cloudTransportStep(physical,j,e,rho,S,ds);cloudTransportStep(clear,j,e,0.,vec3(0),ds);
      CloudSegment segment=emptyCloudSegment();cloudTransportStep(segment,j,e,rho,S,ds);appendCloudSegment(segment,clouds,prefixL,prefixT);
    }
    vec3 result=clouds.rgb+(1.-clouds.a)*(clear.L+clear.T*background),expected=physical.L+physical.T*background;
    out_FragColor=vec4(abs(result-expected),abs(physical.T.r-physical.T.b));}`;
  const airError=Array.from(gpu.draw(airFixture,1,1,{}, {},true).pixels);
  checks.push({name:'ordered segments match the analytic RGB mixed-air/cloud solution without duplicate background scattering',pass:airError.slice(0,3).every(v=>v<1e-6)&&airError[3]>.02,errors:airError});
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),initializationMs:gpu.initializationMs,checks,columns},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · High clouds':'FAIL · High clouds';
}catch(error){output.textContent=String(error);document.title='ERROR · High clouds';}
finally{gpu.destroy();}
