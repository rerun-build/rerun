import { defineConfig, devices } from '@playwright/test'

import { CHROMIUM_ARGS } from './e2e/support/local-stack.cjs'

// The same port as `pnpm verify:ui`, so a hub already running for this workspace is reused.
const PORT = Number(process.env.CONDUCTOR_PORT ?? 3050)
const BASE_URL = `http://localhost:${PORT}`
const CI = Boolean(process.env.CI)
// CI builds the app first (`next build`) and serves that build: a cold `next dev` compiles each route
// and each server action on its first request, which costs a test tens of seconds.
const BUILT_HUB = Boolean(process.env.E2E_BUILT_HUB)

export default defineConfig({
    testDir: 'e2e',
    globalSetup: './e2e/support/global-setup.ts',
    // `next dev` compiles a route on its first request: a cold page takes tens of seconds.
    timeout: 180_000,
    expect: { timeout: 20_000 },
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 1 : 0,
    workers: CI ? 2 : 3,
    reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: BASE_URL,
        locale: 'en-US',
        navigationTimeout: 120_000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: { args: CHROMIUM_ARGS },
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    ],
    webServer: {
        command: `node e2e/support/start-hub.mjs ${PORT}${BUILT_HUB ? ' --built' : ''}`,
        url: `${BASE_URL}/api/version`,
        reuseExistingServer: !CI,
        timeout: 300_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
})
