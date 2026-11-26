import { defineConfig } from '@playwright/test';

const PORT = 8788;
const STATE = '.wrangler/e2e';

// Ujian hujung-ke-hujung berjalan atas Worker sebenar (workerd tempatan) dengan pangkalan data D1 yang
// baharu setiap kali, berasingan dari data `npm run dev`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    launchOptions: {
      // WebGL perisian untuk MapLibre dalam Chromium tanpa GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: [
      'npm run build',
      `rm -rf ${STATE}`,
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`,
      'node scripts/seed-dev.mjs .wrangler/e2e-seed.sql',
      `npx wrangler d1 execute DB --local --persist-to ${STATE} --file .wrangler/e2e-seed.sql`,
      `npx wrangler dev --port ${PORT} --persist-to ${STATE}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
