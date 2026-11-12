const {defineConfig} = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['game-rules.js'],
      exclude: ['tests/**'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {statements: 90, branches: 90, functions: 90, lines: 90}
    }
  }
});
