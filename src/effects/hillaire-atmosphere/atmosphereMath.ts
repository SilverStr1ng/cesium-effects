/** Kilometres, inverse kilometres. Independent implementation of atmospheric transport. */
export const PLANET_RADIUS = 6378.137;
export const ATMOSPHERE_HEIGHT = 100;
export const POLAR_SCALE = 6378137 / 6356752.314245;
export const atmosphereDefaults = { elevation: 28, azimuth: 245, rayleigh: 1, mie: 1, ozone: 1, exposure: 8, sunScale:1.6 };
export type AtmosphereParameters = typeof atmosphereDefaults;

export function sphereInterval(origin: readonly number[], direction: readonly number[], radius: number): [number,number] | null {
  const b=origin[0]*direction[0]+origin[1]*direction[1]+origin[2]*direction[2];
  const c=origin[0]**2+origin[1]**2+origin[2]**2-radius**2;
  const d=b*b-c;
  if(d<0)return null;
  return [-b-Math.sqrt(d),-b+Math.sqrt(d)];
}
export function mediumAt(height: number, p=atmosphereDefaults) {
  const h=Math.max(0,height),r=Math.exp(-h/8)*p.rayleigh,m=Math.exp(-h/1.2)*p.mie;
  const o=Math.max(0,1-Math.abs(h-25)/15)*p.ozone;
  return {
    scattering:[.005802*r+.003996*m,.013558*r+.003996*m,.0331*r+.003996*m],
    extinction:[.005802*r+.00444*m+.00065*o,.013558*r+.00444*m+.001881*o,.0331*r+.00444*m+.000085*o],
  };
}
/** CPU reference integrator for testing the GPU transmittance LUT. */
export function transmittance(height: number, mu: number, p=atmosphereDefaults, steps=256) {
  const origin=[0,0,PLANET_RADIUS+Math.max(.001,height)];
  const direction=[Math.sqrt(Math.max(0,1-mu*mu)),0,mu];
  const ground=sphereInterval(origin,direction,PLANET_RADIUS);
  if(ground&&ground[0]>0)return [0,0,0];
  const end=sphereInterval(origin,direction,PLANET_RADIUS+ATMOSPHERE_HEIGHT)?.[1]??0;
  if(end<=0)return [1,1,1];
  const tau=[0,0,0],ds=end/steps;
  for(let i=0;i<steps;i++){
    const t=(i+.5)*ds,h=Math.hypot(direction[0]*t,0,origin[2]+direction[2]*t)-PLANET_RADIUS;
    const ext=mediumAt(h,p).extinction;
    for(let c=0;c<3;c++)tau[c]+=ext[c]*ds;
  }
  return tau.map(t=>Math.exp(-t));
}
