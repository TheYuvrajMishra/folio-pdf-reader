module.exports = {
  // Pure-TS unit tests (tokens, geometry). RN components are exercised
  // on-device; keep this suite fast and hermetic.
  transform: {
    '^.+\\.[tj]sx?$': [
      'babel-jest',
      { presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]] },
    ],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
