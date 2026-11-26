// Config mínima del smoke e2e (qa/e2e). Playwright NO es dependencia del repo: el workflow lo instala con `npm i --no-save @playwright/test`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'humo-agentes.spec.ts',
  timeout: 90_000,
  retries: 1,
  reporter: [['line']],
  use: { browserName: 'chromium' },
});
