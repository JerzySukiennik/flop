import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/gate-e-*.spec.js',
  timeout: 60000,
  // headless uses SwiftShader (software GL) → 5 fps and a meaningless FPS
  // gate. Headed Chromium gets the real GPU, like actual players.
  use: { viewport: { width: 1280, height: 720 }, headless: false },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/flop/',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
