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
  // Ratcheted gate: the small critical files are enforced at full coverage
  // (the gate suites exercise every statement, branch, function and line of
  // them). routes/payments.js is a 1.8k-line route whose remaining gaps are
  // defensive `x || 'US'` defaults and per-handler error paths, so it is held
  // at its achieved level (98.99% stmts / 85% branches / 97.91% fns / 100%
  // lines) to stop regressions without enforcing an unreachable 100% branch
  // target that would block every refactor.
  coverageThreshold: {
    global: {
      statements: 99,
      branches: 86,
      functions: 98,
      lines: 100,
    },
    './routes/payments.js': {
      statements: 98,
      branches: 85,
      functions: 97,
      lines: 100,
    },
    './routes/inventory.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './middleware/auth.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './criticalRules.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
