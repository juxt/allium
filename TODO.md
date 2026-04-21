# repo-impact-map branch

1. Don't try to combine both grep based searching and impact map searching into a single command.  Rather enable the invoker to run either-or or both.
2. When building the spec->code mapping might as well build just a code-mapping (this will help with code generation without polluting context with specs if required)
3. Implement a decent test-suite on master branch before doing any more changes
4. Implement a harness for development....