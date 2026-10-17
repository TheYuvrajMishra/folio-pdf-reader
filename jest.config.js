/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  // /tmp on this VM is a 512M tmpfs shared with other work; keep jest's
  // cache inside the project instead of the default $TMPDIR/jest_*.
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
};
