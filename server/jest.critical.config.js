const baseJest = require('./package.json').jest;

module.exports = {
  ...baseJest,
  collectCoverage: true,
  collectCoverageFrom: [
    'routes/payments.js',
    'routes/inventory.js',
    'middleware/auth.js',
    'criticalRules.js',
  ],
  coverageDirectory: 'coverage/critical',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 50,
      functions: 65,
      lines: 70,
    },
    './routes/payments.js': {
      statements: 70,
      branches: 50,
      functions: 70,
      lines: 70,
    },
    './routes/inventory.js': {
      statements: 50,
      branches: 50,
      functions: 35,
      lines: 50,
    },
    './middleware/auth.js': {
      statements: 70,
      branches: 40,
      functions: 100,
      lines: 70,
    },
    './criticalRules.js': {
      statements: 95,
      branches: 90,
      functions: 100,
      lines: 95,
    },
  },
};
