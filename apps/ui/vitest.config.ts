import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const CLOUD_SOURCE = path.resolve(import.meta.dirname, '../../cloud/packages/cloud/src')
const HAS_CLOUD = existsSync(CLOUD_SOURCE)
const ADMIN_APP = path.resolve(import.meta.dirname, '../../cloud/apps/admin')
const CLOUD_IMPLEMENTATION = HAS_CLOUD ? CLOUD_SOURCE : path.resolve(import.meta.dirname, 'cloud-oss')

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@moldwright\/cloud\/(.*)$/, replacement: `${CLOUD_IMPLEMENTATION}/$1` },
            { find: '@', replacement: path.resolve(import.meta.dirname, '.') },
            { find: 'server-only', replacement: path.resolve(import.meta.dirname, 'test/server-only-stub.ts') },
        ],
    },
    test: {
        testTimeout: 15000,
        hookTimeout: 15000,
        setupFiles: ['test/intl.ts'],
        include: ['**/*.test.?(c|m)[jt]s?(x)', ...(HAS_CLOUD ? [`${CLOUD_SOURCE}/**/*.test.?(c|m)[jt]s?(x)`, `${ADMIN_APP}/{app,lib}/**/*.test.?(c|m)[jt]s?(x)`] : [])],
        coverage: {
            provider: 'v8',
            include: ['app/**/*.ts', 'lib/**/*.ts', 'trigger/**/*.ts', 'supabase/**/*.ts', 'stores/**/*.ts', 'hooks/**/*.ts', 'proxy.ts'],
            exclude: ['**/*.test.ts', 'app/api/database.types.ts'],
            reporter: ['text-summary', 'html'],
        },
    },
})
