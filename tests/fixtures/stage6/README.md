# Frozen stage-six numerical inputs

`CloudOptics.ts` and `farColumnReference.ts` are copied from
`f433c8e1ef4afd2a4d2f764e8d61d6b191cc4171`, with import paths adjusted only.
They retain the original four grazing counterexamples, sixteen partial inputs,
and the 96-point spatial red gates. Weather, cellular noise and voxel generators
remain unchanged and are imported from production. If any of these generators
changes, freeze that dependency here too before running legacy regressions.

Current morphology has separate references and tests. A new world pattern must
not erase a recorded failure by silently replacing its input.
