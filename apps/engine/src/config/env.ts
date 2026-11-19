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
    // Absolute path to the Codex CLI. Set it when the binary is not on the service user's PATH,
    // or to keep the provider's bundled @openai/codex in node_modules/.bin from shadowing it.
    RERUN_CODEX_PATH: z.string().optional(),
    // `on` opens the desktop of the agents on this box ahead of the release, `off` keeps it shut after.
    RERUN_DESKTOP: z.string().optional(),
    // `on` accepts linked computers on this box ahead of the release, `off` refuses them after.
    RERUN_REMOTE_COMPUTERS: z.string().optional(),
    // `off` stops every check-in of the Chief of Staff on this box, whatever its own switch says.
    RERUN_FOREMAN_CHECKINS: z.string().optional(),
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

// The key and the hub of a server that paired itself are only known once the data-dir is read,
// after the first modules have read the environment: they are set here, on both copies.
export function setEnv(values: Partial<Pick<Env, 'RERUN_API_KEY' | 'RERUN_HUB_BASE_URL'>>): void {
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value
    if (cached) cached = { ...cached, ...values }
}

// `RERUN_DESKTOP=off` keeps the screen, the computer tools and their packages off this box.
export function desktopEnabled(): boolean {
    return env().RERUN_DESKTOP !== 'off'
}

// `RERUN_REMOTE_COMPUTERS=off` refuses the computers' socket and offers no `remote_*` tool.
export function remoteComputersEnabled(): boolean {
    return env().RERUN_REMOTE_COMPUTERS !== 'off'
}

// The emergency stop of the Chief of Staff's check-ins, above the switch each workspace has.
export function checkinsEnabled(): boolean {
    return env().RERUN_FOREMAN_CHECKINS !== 'off'
}
