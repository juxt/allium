# repo-impact-map branch

1. ~~Don't try to combine both grep based searching and impact map searching into a single command.  Rather enable the invoker to run either-or or both.~~ — Addressed: weed/propagate/distill default to grep + read; map mode is opt-in via an explicit user phrase ("use the impact map", "in map mode", "via impact"). See the `## Map mode` appendix in each affected SKILL.md and the `### Opting in` section of `skills/allium/references/impact-map.md`.
2. When building the spec->code mapping might as well build just a code-mapping (this will help with code generation without polluting context with specs if required)
3. Implement a decent test-suite on master branch before doing any more changes
4. Implement a harness for development....