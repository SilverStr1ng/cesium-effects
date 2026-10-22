// Radiance integration and display transform are separate seams for GPU regression tests.
uniform float u_exposure;
vec3 cloudSource(vec3 radiance){return max(vec3(0),radiance);}
vec3 cloudDisplay(vec3 radiance){return displayRadiance(radiance,u_exposure);}
// Compatibility for a producer without a scene-linear attachment. Cesium surface
// LDR only has an effective inverse; this path never reconstructs our sun/moon.
vec3 cloudBackground(vec3 display){return recoverRadiance(display,u_exposure);}
