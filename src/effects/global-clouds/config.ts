export const cloudDefaults={coverage:.62,density:1.1,base:1.5,thickness:3.8,wind:24,detail:.55,seed:13};
export type CloudParameters=typeof cloudDefaults;
export const cloudQualities={low:{steps:40,lightSteps:3,scale:.5},medium:{steps:64,lightSteps:5,scale:.65},high:{steps:96,lightSteps:7,scale:1}};
export type CloudQuality=keyof typeof cloudQualities;
