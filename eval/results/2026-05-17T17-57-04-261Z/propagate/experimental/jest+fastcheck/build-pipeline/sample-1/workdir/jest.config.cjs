/** Minimal Jest config for propagate-generated tests. */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2022",
          module: "CommonJS",
          moduleResolution: "Node",
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: false,
          strict: false,
          skipLibCheck: true,
        },
        diagnostics: false,
      },
    ],
  },
};
