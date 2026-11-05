import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { CONNECTION_TOKEN_KEY } from '@rerun/contracts'
import { codexHomeDir } from '../config/paths.js'
import { childProcessEnv } from '../lib/child-env.js'
import { logger } from '../lib/logger.js'
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

// The provider drops `account/rateLimits/updated` before anyone can see it and exposes no way to
// send a request of our own, so the reading takes a short app-server session: handshake, the plan
// limits and the model list the account is offered by this binary, gone. Resolves to null on any
// failure: a missing gauge is never worth an error. A list that never comes back does not cost the
// gauge that did: the timer settles whatever arrived.
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
                // A partial page would read as models the account lacks: no reading beats a wrong one.
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
        // The CLI may have rotated the token while it was up, exactly as it does during a run.
        await syncCodexAuth(connection)
        recordPlanLimits(connection.id, planLimitWindowsFromCodex(session?.rateLimits ?? null))
        if (session) recordCliModels(connection.id, session.models, session.version, codexOffPin(session.version))
    })()
        .catch(err => logger.warn({ connection: connection.id, err: (err as Error).message }, 'codex plan limits read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

// Called on the paths that must not wait for a process: the caller answers with the reading it
// has, and the fresh one is there for the next ask. Paced on the last attempt rather than the last
// reading, so a connection that cannot be read is not respawned on every list.
export function refreshStaleCodexPlanLimits(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshCodexPlanLimits(connection)
    }
}
