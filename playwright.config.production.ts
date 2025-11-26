import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for PRODUCTION testing
 * Tests against cda.ilinqsoft.com domain
 *
 * Usage:
 *   pnpm test:production           # Run all tests
 *   pnpm test:production --headed  # Run with visible browser
 *   pnpm test:production --ui      # Run with Playwright UI
 */

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://cda.ilinqsoft.com';
const API_URL = process.env.API_URL || PRODUCTION_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 2, // Retry failed tests on production
  workers: process.env.CI ? 4 : 8, // Parallel workers
  timeout: 60000, // 60s timeout per test
  expect: {
    timeout: 10000, // 10s for assertions
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report-production' }],
    ['list'],
    ['json', { outputFile: 'test-results/production-results.json' }],
  ],

  use: {
    baseURL: PRODUCTION_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true, // Headless for production tests
    actionTimeout: 15000,
    navigationTimeout: 30000,
    // Extra HTTP headers for API tests
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },

  // Define environment variables for tests
  env: {
    API_URL: API_URL,
    DASHBOARD_URL: PRODUCTION_URL,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // No webServer for production - test against live server
});
