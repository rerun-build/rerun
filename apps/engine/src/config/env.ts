import { z } from 'zod'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { closeSync, readFileSync } from 'node:fs'

const schema = z.object({
    RERUN_DATA_DIR: z.string().default(resolve(homedir(), '.rerun')),
    RERUN_PORT: z.coerce.number().int().positive().default(3000),
    RERUN_HOST: z.string().default('0.0.0.0'),
    RERUN_API_KEY: z.string().optional(),
    RERUN_HUB_BASE_URL: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
    RERUN_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RERUN_CODEX_PATH: z.string().optional(),
    RERUN_DESKTOP: z.string().optional(),
    RERUN_FS_EXTRA_ROOTS: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

let heldKey: string | undefined

export function takeKeyFromDescriptor(): void {
    const signalled = process.env.RERUN_KEY_FD
    if (signalled === undefined) return
    delete process.env.RERUN_KEY_FD
    const fd = Number(signalled)
    let key = ''
    try {
        if (Number.isInteger(fd) && fd > 2) key = readFileSync(fd, 'utf8').trim()
    } catch {
        key = ''
    } finally {
        if (Number.isInteger(fd) && fd > 2) {
            try {
                closeSync(fd)
            } catch {
            }
        }
    }
    if (!key) throw new Error('the launcher signalled a key descriptor, but it held no key')
    heldKey = key
    if (cached) cached = { ...cached, RERUN_API_KEY: key }
}

export function env(): Env {
    if (cached) return cached
    if (process.env.RERUN_KEY_FD !== undefined && heldKey === undefined) throw new Error('the key descriptor was signalled but not read: call takeKeyFromDescriptor() first')
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')
        throw new Error(`Invalid environment: ${issues}`)
    }
    cached = heldKey === undefined ? parsed.data : { ...parsed.data, RERUN_API_KEY: heldKey }
    return cached
}

export function setEnv(values: Partial<Pick<Env, 'RERUN_API_KEY' | 'RERUN_HUB_BASE_URL'>>): void {
    if (values.RERUN_API_KEY !== undefined) heldKey = values.RERUN_API_KEY
    if (values.RERUN_HUB_BASE_URL !== undefined) process.env.RERUN_HUB_BASE_URL = values.RERUN_HUB_BASE_URL
    if (cached) cached = { ...cached, ...values }
}

const DESKTOP_RELEASED = true

export function desktopEnabled(): boolean {
    const flag = env().RERUN_DESKTOP
    return flag === 'on' || (DESKTOP_RELEASED && flag !== 'off')
}
