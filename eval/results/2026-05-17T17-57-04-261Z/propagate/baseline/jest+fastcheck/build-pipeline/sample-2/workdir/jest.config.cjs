/** Jest config for the propagated test suite.
 *  The project uses ESM ("type": "module") + .ts source with .js import suffixes;
 *  ts-jest handles the TypeScript transform and the moduleNameMapper rewrites
 *  the .js suffix back to the .ts source.
 */
module.exports = {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          esModuleInterop: true,
          isolatedModules: true,
          lib: ["ES2022"],
        },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};
