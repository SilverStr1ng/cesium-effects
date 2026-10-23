// type: 0 weather blend, 1 stratus, 2 stratocumulus, 3 cumulus.
export const cloudDefaults={coverage:.62,density:1.1,base:1.5,thickness:3.8,wind:24,detail:.55,seed:13,
  type:0,highCoverage:.35,highBase:9,highThickness:1.5,highWind:48,
  highType:0,highOpticalDepth:.35,highAnisotropy:.78,highAlbedo:.98,highMultiple:.12};
export type CloudParameters=typeof cloudDefaults;
/** Optical depth is the vertical column tau at unit weather/material mask. */
export const highCloudPresets={
  cirrus:{highType:0,highCoverage:.45,highOpticalDepth:.35,highThickness:1.5,highAnisotropy:.78,highAlbedo:.98,highMultiple:.12},
  cirrostratus:{highType:1,highCoverage:.85,highOpticalDepth:.28,highThickness:1.2,highAnisotropy:.72,highAlbedo:.99,highMultiple:.08},
} satisfies Record<string,Partial<CloudParameters>>;
export const cloudQualities={low:{steps:40,lightSteps:3,substeps:2,scale:.5},medium:{steps:64,lightSteps:5,substeps:3,scale:.65},high:{steps:96,lightSteps:7,substeps:4,scale:1}};
export type CloudQuality=keyof typeof cloudQualities;
export type CloudView='below'|'inside'|'above'|'between'|'high'|'global';
