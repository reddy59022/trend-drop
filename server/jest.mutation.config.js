const baseJest = require('./package.json').jest;

module.exports = {
  ...baseJest,
  collectCoverage: false,
  testMatch: [
    '<rootDir>/tests/criticalRules.test.js',
    '<rootDir>/tests/revenueInvariants.test.js',
  ],
};
