# Frozen stage-seven candidate

These three files retain the `87b6ff032afe4229c9e42d9925b4ecc460867940`
CPU far-model law, optical ensemble and material transform. Only import paths
were adapted. `cloud-candidate-history.test.ts` deliberately checks that the
two recorded opacity errors remain above .02; a passing history test means the
old failure is preserved, not that the rendering problem is fixed.

The unchanged generators remain shared with production. Their Git blob IDs at
the review revision are listed below. If a later change edits one of them,
copy that original dependency into this fixture and redirect its imports before
using the old input as a regression. Do not update the old expected errors to
match a new world.

| Dependency | Review blob |
| --- | --- |
| `src/effects/global-clouds/CumulusNoise.ts` | `bf0414e6c104f34238131af9bf5e03104d684180` |
| `src/effects/global-clouds/VoxelCloudField.ts` | `23713da3867adb37feb5a1fe497165b58f8467d1` |
| `src/effects/global-clouds/WeatherField.ts` | `5c1bc940cf8a18f7e0168026b8de50760a55d575` |
| `src/scene/CloudNoise.ts` | `d2dfa31deabba6ee55fbbd863c23371b64c0994e` |
| `src/effects/hillaire-atmosphere/atmosphereMath.ts` | `fd8f3d468125f72780d6ced497de9fc797eae6a4` |

The separate `stage6` fixture and the evidence package's full review source
archive retain the earlier model and the original GLSL respectively.
