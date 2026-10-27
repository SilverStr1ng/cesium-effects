// Keep light/substep loops specialized for their constant angular/logarithmic
// taps. Runtime outer/height bounds express one shared march body per shell/LOD;
// they preserve the quality budgets and are NOT a guarantee of faster linking.
uniform float u_cloudSteps,u_cloudIntervals,u_cloudRepresentations;
#define CLOUD_STEPS int(u_cloudSteps)
#define CLOUD_INTERVAL_COUNT int(u_cloudIntervals)
#define CLOUD_REPRESENTATION_COUNT int(u_cloudRepresentations)
