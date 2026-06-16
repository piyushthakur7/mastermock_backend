export default {
  transform: {},
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testEnvironment: 'node',
  verbose: true,
  moduleFileExtensions: ['js', 'json', 'node'],
  testMatch: ['**/tests/**/*.test.js'],
};
