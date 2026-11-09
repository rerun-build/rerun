import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// `@rerun/cloud/*` is Rerun Cloud's code when the private `cloud/` folder sits in the checkout, and the
// self-hosted implementation of `cloud-oss/` otherwise: the same fallback as the `paths` of tsconfig.
const CLOUD_SOURCE = path.resolve(import.meta.dirname, '../../cloud/packages/cloud/src')
const HAS_CLOUD = existsSync(CLOUD_SOURCE)
// The back office of Rerun Cloud runs on this app's sources, and so do its tests.
const ADMIN_APP = path.resolve(import.meta.dirname, '../../cloud/apps/admin')
const CLOUD_IMPLEMENTATION = HAS_CLOUD ? CLOUD_SOURCE : path.resolve(import.meta.dirname, 'cloud-oss')

// Vitest does not read the `@/*` paths from tsconfig, so a unit test importing any module that
// resolves one fails at import time rather than on an assertion.
export default defineConfig({
    resolve: {
        // `server-only` is a Next marker package with no Node entry point, so any module carrying it
        // fails at import time here rather than on an assertion. Stubbed to nothing, which is
        // exactly what it does at runtime once the bundler has checked where it is imported from.
        alias: [
            { find: /^@rerun\/cloud\/(.*)$/, replacement: `${CLOUD_IMPLEMENTATION}/$1` },
            { find: '@', replacement: path.resolve(import.meta.dirname, '.') },
            { find: 'server-only', replacement: path.resolve(import.meta.dirname, 'test/server-only-stub.ts') },
        ],
    },
    test: {
        // Use the DOM environment's storage instead of Node's file-backed global.
        execArgv: ['--no-experimental-webstorage'],
        setupFiles: ['test/setup-env.ts'],
        // The tests of Rerun Cloud's side run with the app's, against the same aliases and setup.
        include: ['**/*.test.?(c|m)[jt]s?(x)', ...(HAS_CLOUD ? [`${CLOUD_SOURCE}/**/*.test.?(c|m)[jt]s?(x)`, `${ADMIN_APP}/{app,lib}/**/*.test.?(c|m)[jt]s?(x)`] : [])],
        coverage: {
            provider: 'v8',
            // React components are left out: the suite runs in a bare Node environment, so a `.tsx`
            // file only ever shows up here as noise.
            include: ['app/**/*.ts', 'lib/**/*.ts', 'trigger/**/*.ts', 'ee/**/*.ts', 'supabase/**/*.ts', 'stores/**/*.ts', 'hooks/**/*.ts', 'proxy.ts'],
            exclude: ['**/*.test.ts', 'app/api/database.types.ts'],
            reporter: ['text-summary', 'html'],
        },
    },
})
