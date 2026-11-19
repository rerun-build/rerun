import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { CONNECTION_TOKEN_KEY } from '@moldwright/contracts'
import { codexHomeDir } from '../config/paths.js'
import { childProcessEnv } from '../lib/child-env.js'
import { logger } from '../lib/logger.js'
import { repairBoxDefault } from '../agents/availability.js'
import { codexCommand, codexOffPin, parseCodexVersion } from '../runtime/codex-cli.js'
import { recordCliModels } from './cli-models.js'
import { ensureCodexAuth, syncCodexAuth } from './codex-auth.js'
import { planLimitWindowsFromCodex, recordPlanLimits, type CodexRateLimits } from './plan-limits.js'
import type { LoadedConnection } from './types.js'

const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 5 * 60_000

const INITIALIZE_ID = 1
const READ_ID = 2
const MODELS_ID = 3

export type CodexSession = { rateLimits: CodexRateLimits | null; models: string[]; version: string | null }

type ModelList = { data?: { id?: unknown; hidden?: unknown }[]; nextCursor?: unknown }

export function readCodexSession(connectionId: string, timeoutMs = READ_TIMEOUT_MS): Promise<CodexSession | null> {
    return new Promise(resolve => {
        const { cmd, args } = codexCommand()
        const home = codexHomeDir(connectionId)
        const child = spawn(cmd, [...args, 'app-server', '--listen', 'stdio://'], {
            stdio: ['pipe', 'pipe', 'ignore'],
            env: { ...childProcessEnv({}), CODEX_HOME: home, RUST_LOG: process.env.RUST_LOG || 'error' },
            cwd: home,
        })
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
        const session: CodexSession = { rateLimits: null, models: [], version: null }
        let pending = 2

        let settled = false
        const settle = (result: CodexSession | null): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            lines.close()
            child.kill('SIGTERM')
            resolve(result)
        }
        const answered = (): void => {
            pending -= 1
            if (pending === 0) settle(session)
        }
        const timer = setTimeout(() => settle(session.rateLimits ? session : null), timeoutMs)
        const send = (message: Record<string, unknown>): void => {
            child.stdin.write(`${JSON.stringify(message)}\n`)
        }

        child.once('error', () => settle(null))
        child.once('close', () => settle(null))
        child.stdin.on('error', () => settle(null))
        lines.on('line', line => {
            let message: { id?: unknown; result?: unknown; error?: unknown }
            try {
                message = JSON.parse(line)
            } catch {
                return
            }
            if (message.id === INITIALIZE_ID) {
                if (message.error) return settle(null)
                const userAgent = (message.result as { userAgent?: unknown } | undefined)?.userAgent
                session.version = typeof userAgent === 'string' ? parseCodexVersion(userAgent) : null
                send({ method: 'initialized' })
                send({ id: READ_ID, method: 'account/rateLimits/read' })
                send({ id: MODELS_ID, method: 'model/list', params: {} })
            } else if (message.id === READ_ID) {
                session.rateLimits = message.error ? null : ((message.result ?? null) as CodexRateLimits | null)
                answered()
            } else if (message.id === MODELS_ID) {
                const list = message.error ? undefined : (message.result as ModelList | undefined)
                const data = list?.nextCursor ? [] : (list?.data ?? [])
                session.models = data.filter(model => typeof model.id === 'string' && model.hidden !== true).map(model => model.id as string)
                answered()
            }
        })

        send({ id: INITIALIZE_ID, method: 'initialize', params: { clientInfo: { name: 'rerun-engine', version: '1' }, capabilities: { experimentalApi: true } } })
    })
}

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

export function refreshCodexPlanLimits(connection: LoadedConnection | null): Promise<void> {
    if (!connection || connection.config.provider !== 'codex' || !connection.env[CONNECTION_TOKEN_KEY.codex]) return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        await ensureCodexAuth(connection)
        const session = await readCodexSession(connection.id)
        await syncCodexAuth(connection)
        recordPlanLimits(connection.id, planLimitWindowsFromCodex(session?.rateLimits ?? null))
        if (session) recordCliModels(connection.id, session.models, session.version, codexOffPin(session.version))
        await repairBoxDefault(connection)
    })()
        .catch(err => logger.warn({ connection: connection.id, err: (err as Error).message }, 'codex plan limits read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

export function pendingCodexPlanLimits(connectionId: string): Promise<void> | undefined {
    return inFlight.get(connectionId)
}

export function refreshStaleCodexPlanLimits(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshCodexPlanLimits(connection)
    }
}
