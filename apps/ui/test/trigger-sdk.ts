import { vi } from 'vitest'

export function triggerSdkMock() {
    const define = <T extends object>(config: T) => ({ ...config, trigger: vi.fn().mockResolvedValue({ id: 'run_test' }), batchTrigger: vi.fn().mockResolvedValue({ runs: [] }), triggerAndWait: vi.fn() })
    return {
        task: define,
        schedules: { task: define },
        queue: <T>(config: T) => config,
        logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        wait: { for: vi.fn().mockResolvedValue(undefined), until: vi.fn().mockResolvedValue(undefined) },
        runs: { list: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
        tasks: { trigger: vi.fn().mockResolvedValue({ id: 'run_test' }) },
        AbortTaskRunError: class AbortTaskRunError extends Error {},
    }
}

export function runContext(environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'PREVIEW' = 'PRODUCTION') {
    return { ctx: { environment: { type: environment }, run: { id: 'run_test' }, attempt: { number: 1 } } } as never
}
