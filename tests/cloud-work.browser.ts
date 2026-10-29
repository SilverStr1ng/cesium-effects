import {Cartesian3,JulianDate} from 'cesium';
import scenes from './cloud-work-scenes.json';
import {cloudProbe} from './cloudProbe';
import {prepareCelestialFrame} from './celestialFixture';
import {celestialPositions,resolveCelestialState} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import atmosphere from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import transport from '../src/effects/global-clouds/shaders/transport.glsl?raw';
import quality from '../src/effects/global-clouds/shaders/quality.glsl?raw';
const output=document.querySelector('#result')!;
try{
  const gpu=cloudProbe(document.querySelector('canvas')!),rows=[];
  const source='#define LAYERED_CLOUDS\n#define CLOUD_DIAGNOSTICS\n'+quality+common+atmosphere+density+voxel+`
    uniform vec3 u_camera,u_direction,u_right,u_up,u_moon;uniform float u_pixelAngle,u_moonFraction,u_moonGain,u_debugView,u_mode;
    uniform bool u_atmosphere;struct CloudPhases{vec3 sun;vec3 moon;};
    float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;vec4 branchByLayer=vec4(0);vec3 cloudSource(vec3 L){return L;}`+
    environment+lighting+intervals+transport+march.slice(march.indexOf('CloudSegment integrateCloud'),march.indexOf('void main()')).replace('cloudBranchWork[mode-1]+=1.;','cloudBranchWork[mode-1]+=1.;branchByLayer[cloudLayer*2+mode-1]+=1.;')+`
    void main(){vec2 xy=(gl_FragCoord.xy/vec2(5,3)*2.-1.)*tan(PI/6.);xy.x*=1920./1080.;vec3 metric=vec3(1,1,1.00336409);
      vec3 d=normalize((u_direction+u_right*xy.x+u_up*xy.y)*metric);cloudScreenRight=u_right*metric;cloudScreenUp=u_up*metric;
      float maximum=1e8;vec2 ground=sphere(u_camera,d,Rg);if(ground.x>0.)maximum=ground.x;
      vec2 parts[4];int layers[4];cloudIntervals(u_camera,d,maximum,parts,layers);vec4 acc=vec4(0);vec3 airL=vec3(0),airT=vec3(1);float cursor=0.;
      for(int i=0;i<CLOUD_INTERVAL_COUNT;i++){cloudLayer=layers[i];integrateCloudInterval(d,parts[i],acc,airL,airT,cursor);if(acc.a>.995)break;}
      out_FragColor=u_mode<.5?cloudWork:u_mode<1.5?vec4(cloudCacheMiss,0):u_mode<2.5?branchByLayer:vec4(cloudDensityWork,0);}`;
  for(const scene of scenes){
    const time=JulianDate.fromIso8601(scene.utc);await prepareCelestialFrame(time);
    const light=resolveCelestialState(celestialPositions(time),Cartesian3.ZERO).lighting;
    const right=Cartesian3.cross(Cartesian3.unpack(scene.camera.direction),Cartesian3.unpack(scene.camera.up),new Cartesian3());
    const u={...gpu.uniforms,u_camera:scene.camera.position.map((x,i)=>x*.001*(i===2?1.00336409:1)),u_direction:scene.camera.direction,u_right:Cartesian3.pack(right,[]),u_up:scene.camera.up,
      u_sun:Cartesian3.pack(light.sunDirection,[]),u_moon:Cartesian3.pack(light.moonDirection,[]),u_moonFraction:light.moonFraction,u_moonGain:1,u_atmosphere:false,u_hasSkyIrradiance:false,
      u_pixelAngle:2*Math.tan(Math.PI/6)/(1080*.65),u_debugView:0,u_coverage:scene.clouds.parameters.coverage,u_highCoverage:scene.clouds.parameters.highCoverage,
      u_cloudSteps:64,u_lightSteps:5,u_cloudSubsteps:3,u_cloudIntervals:4,u_cloudRepresentations:2};
    const values=[0,1,2,3].map(u_mode=>Array.from(gpu.draw(source,5,3,{...u,u_mode},gpu.inputs,true).pixels));
    const rays=Array.from({length:15},(_,i)=>({pixel:[i%5,Math.floor(i/5)],densityCalls:values[3][i*4],bodyQueries:values[3][i*4+1],opaqueExits:values[3][i*4+2],builds:values[0][i*4],taps:values[0][i*4+1],tableQueries:values[0][i*4+2],legacyHits:values[0][i*4+3],missReasons:values[1].slice(i*4,i*4+3),resolvedSegments:values[2][i*4],statisticalSegments:values[2][i*4+1],highResolvedSegments:values[2][i*4+2],highStatisticalSegments:values[2][i*4+3]}));
    rows.push({name:scene.name,conditions:scene,rays,pass:rays.every(r=>r.builds<=2&&r.legacyHits===0&&Number.isFinite(r.taps))});
  }
  gpu.destroy();output.textContent=JSON.stringify({passed:rows.every(r=>r.pass),rows,scope:'15 selected rays per fixed seven-scene camera. Real density/lighting/march and finite shell clipping, diagnostic counters only; no GPU timing. Atmosphere source disabled because it does not affect cloudT, branch choice, footprint or builds. Ground is ellipsoid, no DEM. One distribution per statistical shell interval; no reuse across intervals. Miss fields are position/footprint/slant triggers of the retained legacy helper; the production response forces a new build per interval and has no legacy cache hits.'},null,2);
  document.title=rows.every(r=>r.pass)?'PASS · Work counters':'FAIL · Work counters';
}catch(error){output.textContent=String(error);document.title='ERROR · Work counters';}
