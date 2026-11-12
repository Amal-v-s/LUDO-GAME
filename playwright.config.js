const {defineConfig} = require('@playwright/test');
const fs = require('node:fs');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: {
      ...(fs.existsSync('/usr/bin/google-chrome') ? {executablePath: '/usr/bin/google-chrome'} : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node --require ./tests/support/deterministic-dice.cjs server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    env: {PORT: '4173', DATABASE_URL: '', LUDO_TEST_DICE: '6,2,1,6,3,4,5'}
  }
});
