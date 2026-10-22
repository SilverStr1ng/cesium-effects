# Project conventions

- Canonical remote: https://github.com/SilverStr1ng/cesium-effects.git.
- User requests completed changes to be committed and pushed to this repository unless they explicitly say otherwise. Preserve remote history; never force-push by default.
- Use Angular-style commit messages: `type(scope): imperative description`, for example `feat(tornado): add turbulent storm canopy` or `perf(volume): cache cloud noise in a 3d texture`.
- Project code is MIT licensed. Keep third-party licenses and attributions intact. Do not redistribute reference video images as project assets.
- Keep `.env`, access tokens, generated `public/cesium`, `dist`, and local `artifacts` out of Git.
- Each effect belongs under `src/effects/<id>/` and owns its workers, textures, scene objects and event listeners. Dispose all resources on unmount/rebuild.
- Verify nontrivial numerical/rendering changes with `npm test`, `npm run build`, and a real browser shader/rendering check. Report measured performance and disclose unverified visual targets; do not invent similarity percentages.
