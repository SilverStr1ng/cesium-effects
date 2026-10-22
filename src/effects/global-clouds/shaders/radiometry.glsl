// Radiance integration and display transform are separate seams for GPU regression tests.
uniform float u_exposure;
vec3 cloudSource(vec3 radiance){return max(vec3(0),radiance);}
vec3 cloudDisplay(vec3 radiance){return displayRadiance(radiance,u_exposure);}
// Cesium's preceding atmosphere pass has already applied this display transform.
// Reconstruct an effective linear background; clipped solar highlights cannot be recovered.
vec3 cloudBackground(vec3 display){return recoverRadiance(display,u_exposure);}
