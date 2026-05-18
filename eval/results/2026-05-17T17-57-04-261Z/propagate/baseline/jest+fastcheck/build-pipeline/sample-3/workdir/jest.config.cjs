/**
 * Jest config for the build-pipeline fixture.
 *
 * The fixture source ships with `"type": "module"` and uses `.js` import
 * specifiers on its TypeScript files. Under strict ESM, the cycle
 *   src/index.ts -> src/routes.ts -> src/index.ts
 * trips a TDZ error on `export const router` because ESM hoists the
 * side-effect `import "./routes.js"` above the const initialiser. The
 * fixture compiles fine under CommonJS transpilation (where `module.exports`
 * is populated incrementally), so we run ts-jest in CJS mode and strip the
 * `.js` suffix from import specifiers so they resolve against the `.ts`
 * sources.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
