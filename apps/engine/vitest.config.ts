import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        testTimeout: 15000,
        hookTimeout: 15000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.test.ts',
                'src/cli/bin.ts',
                'src/cli/commands/doctor.ts',
                'src/cli/commands/migrate.ts',
                'src/cli/commands/run.ts',
                'src/**/types.ts',
                'src/db/schema.ts',
            ],
            reporter: ['text-summary', 'text', 'html'],
            thresholds: { lines: 98, statements: 96, functions: 95, branches: 92 },
        },
    },
})
