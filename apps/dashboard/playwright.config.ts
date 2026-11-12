import { defineConfig, devices } from '@playwright/test';

/**
 * Demo-only smoke tests against the production build (`vite preview`).
 * No AWS access, no credentials. Live E2E tests arrive with the Live API.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    // E2E is Demo-only and must not pick up a developer's Live config (.env.local).
    env: {
      VITE_API_BASE_URL: '',
      VITE_COGNITO_USER_POOL_ID: '',
      VITE_COGNITO_CLIENT_ID: '',
      VITE_COGNITO_DOMAIN: '',
    },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
