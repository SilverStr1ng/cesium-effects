import {Cartesian3,Cartographic,CustomHeightmapTerrainProvider,Ellipsoid,GeographicTilingScheme,type Viewer} from 'cesium';

/** Deterministic local ridge: exercises Cesium's real terrain depth, without a
 * token or network DEM. It is a fixture, not a claim of real-world topography. */
export function horizonView(viewer:Viewer,body:Cartesian3,ridge:boolean){
  const direction=Cartesian3.normalize(body,new Cartesian3());
  const tangent=Cartesian3.normalize(Cartesian3.cross(direction,Cartesian3.UNIT_Z,new Cartesian3()),new Cartesian3());
  const positionAt=(theta:number)=>{
    const radial=Cartesian3.add(Cartesian3.multiplyByScalar(direction,Math.cos(theta),new Cartesian3()),Cartesian3.multiplyByScalar(tangent,Math.sin(theta),new Cartesian3()),new Cartesian3());
    return Cartesian3.fromRadians(Math.atan2(radial.y,radial.x),Math.asin(radial.z),800);
  };
  let lo=1.3,hi=1.6;
  for(let i=0;i<40;i++){
    const theta=(lo+hi)/2,p=positionAt(theta),up=Ellipsoid.WGS84.geodeticSurfaceNormal(p),d=Cartesian3.normalize(Cartesian3.subtract(body,p,new Cartesian3()),new Cartesian3());
    if(Cartesian3.dot(d,up)>Math.sin(.75*Math.PI/180))lo=theta;else hi=theta;
  }
  const position=positionAt((lo+hi)/2),up=Ellipsoid.WGS84.geodeticSurfaceNormal(position);
  const ray=Cartesian3.normalize(Cartesian3.subtract(body,position,new Cartesian3()),new Cartesian3());
  const forward=Cartesian3.normalize(Cartesian3.subtract(ray,Cartesian3.multiplyByScalar(up,Cartesian3.dot(ray,up),new Cartesian3()),new Cartesian3()),new Cartesian3());
  const side=Cartesian3.cross(forward,up,new Cartesian3());
  const center=Ellipsoid.WGS84.scaleToGeodeticSurface(Cartesian3.add(position,Cartesian3.multiplyByScalar(forward,20000,new Cartesian3()),new Cartesian3()))!;
  if(ridge){
    const scheme=new GeographicTilingScheme(),size=64;
    viewer.terrainProvider=new CustomHeightmapTerrainProvider({width:size,height:size,tilingScheme:scheme,callback:(x,y,level)=>{
      const rectangle=scheme.tileXYToRectangle(x,y,level),heights=new Float32Array(size*size),point=new Cartesian3();
      for(let j=0;j<size;j++)for(let i=0;i<size;i++){
        Cartesian3.fromRadians(rectangle.west+(rectangle.east-rectangle.west)*i/(size-1),rectangle.north-(rectangle.north-rectangle.south)*j/(size-1),0,Ellipsoid.WGS84,point);
        Cartesian3.subtract(point,center,point);
        const across=Cartesian3.dot(point,side)/12000,along=Cartesian3.dot(point,forward)/5000;
        heights[i+j*size]=1150*Math.exp(-across*across-along*along);
      }
      return heights;
    }});
  }
  viewer.camera.setView({destination:position,orientation:{direction:ray,up}});
  return {kind:ridge?'procedural 1150 m ridge':'ellipsoid',camera:Cartographic.fromCartesian(position),centre:Cartographic.fromCartesian(center),altitudeDegrees:.75};
}
