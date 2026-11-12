import { defineConfig } from 'vitest/config'

export default defineConfig({
    define: { __RERUN_CHANNEL__: '"dev"', __RERUN_DEFAULT_SERVER_URL__: '""' },
    test: { include: ['test/**/*.test.ts'] },
})
