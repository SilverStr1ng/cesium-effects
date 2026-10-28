// All quality levels share one source/program. Counts change the same sample
// positions and budgets at runtime; attachment resolution remains per quality.
uniform float u_cloudSteps,u_cloudIntervals,u_cloudRepresentations,u_lightSteps,u_cloudSubsteps;
#define LIGHT_STEPS int(u_lightSteps)
#define CLOUD_SUBSTEPS int(u_cloudSubsteps)
#define CLOUD_STEPS int(u_cloudSteps)
#define CLOUD_INTERVAL_COUNT int(u_cloudIntervals)
#define CLOUD_REPRESENTATION_COUNT int(u_cloudRepresentations)
