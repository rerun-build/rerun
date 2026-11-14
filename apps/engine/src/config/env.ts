import { z } from 'zod'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const schema = z.object({
    RERUN_DATA_DIR: z.string().default(resolve(homedir(), '.rerun')),
    RERUN_PORT: z.coerce.number().int().positive().default(3000),
    RERUN_HOST: z.string().default('0.0.0.0'),
    RERUN_API_KEY: z.string().optional(),
    RERUN_HUB_BASE_URL: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
    RERUN_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RERUN_CODEX_PATH: z.string().optional(),
    RERUN_DESKTOP: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function env(): Env {
    if (cached) return cached
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
        throw new Error(`Invalid environment: ${issues}`)
    }
    cached = parsed.data
    return cached
}

export function setEnv(values: Partial<Pick<Env, 'RERUN_API_KEY' | 'RERUN_HUB_BASE_URL'>>): void {
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value
    if (cached) cached = { ...cached, ...values }
}

const DESKTOP_RELEASED = true

export function desktopEnabled(): boolean {
    const flag = env().RERUN_DESKTOP
    return flag === 'on' || (DESKTOP_RELEASED && flag !== 'off')
}
