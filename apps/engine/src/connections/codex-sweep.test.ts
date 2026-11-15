import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cxsweep-'))

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { existsSync } = await import('node:fs')
const { mkdir, readdir, rm, writeFile } = await import('node:fs/promises')
const { codexAuthPath, codexHomeDir, connectionConfigPath, connectionDir, connectionsDir } = await import('../config/paths.js')
const { registerRunAbort, unregisterRunAbort } = await import('../runtime/run-control.js')
const { sweepCodexHome, sweepCodexHomesIfDue } = await import('./codex-sweep.js')
const { codexThreadToResume, rememberCodexThread } = await import('../agents/codex-threads.js')

const CODEX_ID = 'codexconnection'
const CLAUDE_ID = 'claudeconnection'

async function seedConnection(id: string, provider: string): Promise<void> {
    await mkdir(connectionDir(id), { recursive: true })
    await writeFile(connectionConfigPath(id), JSON.stringify({ name: id, provider, createdAt: new Date().toISOString() }), 'utf8')
}

async function seedCodexHome(id: string): Promise<void> {
    const home = codexHomeDir(id)
    await mkdir(resolve(home, 'sessions', '2026', '10', '09'), { recursive: true })
    await mkdir(resolve(home, 'archived_sessions'), { recursive: true })
    await mkdir(resolve(home, 'skills'), { recursive: true })
    await writeFile(resolve(home, 'sessions', '2026', '10', '09', 'rollout-1.jsonl'), '{}', 'utf8')
    for (const name of ['logs_2.sqlite', 'logs_2.sqlite-wal', 'logs_2.sqlite-shm', 'state_5.sqlite', 'thread_history_1.sqlite']) await writeFile(resolve(home, name), 'x', 'utf8')
    await writeFile(resolve(home, 'config.toml'), '', 'utf8')
    await writeFile(codexAuthPath(id), '{}', 'utf8')
}

beforeEach(async () => {
    await rm(connectionsDir(), { recursive: true, force: true })
    await seedConnection(CODEX_ID, 'codex')
    await seedCodexHome(CODEX_ID)
})

describe('sweepCodexHome', () => {
    it('removes the sessions and every SQLite file, and keeps the rest of the home', async () => {
        await sweepCodexHome(CODEX_ID)
        expect((await readdir(codexHomeDir(CODEX_ID))).sort()).toEqual(['auth.json', 'config.toml', 'skills'])
    })

    it('forgets the threads of the connection it sweeps', async () => {
        rememberCodexThread('agent', 'session', { threadId: 'thread-1', connectionId: CODEX_ID, throughMessageId: 'msg-1' })
        await sweepCodexHome(CODEX_ID)
        expect(codexThreadToResume('agent', 'session', CODEX_ID, 'msg-1')).toBeUndefined()
    })

    it('does nothing for a connection that has no Codex home', async () => {
        await seedConnection(CLAUDE_ID, 'claude')
        await expect(sweepCodexHome(CLAUDE_ID)).resolves.toBeUndefined()
        expect(existsSync(codexHomeDir(CLAUDE_ID))).toBe(false)
    })
})

describe('sweepCodexHomesIfDue', () => {
    afterEach(() => vi.useRealTimers())

    it('waits for the box to be idle, sweeps once, then holds off for a day', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const logs = resolve(codexHomeDir(CODEX_ID), 'logs_2.sqlite')

        registerRunAbort('run-1', 'agent-1')
        await sweepCodexHomesIfDue()
        expect(existsSync(logs)).toBe(true)

        unregisterRunAbort('run-1')
        await sweepCodexHomesIfDue()
        expect(existsSync(logs)).toBe(false)
        expect(existsSync(codexAuthPath(CODEX_ID))).toBe(true)

        await seedCodexHome(CODEX_ID)
        vi.setSystemTime(Date.now() + 3_600_000)
        await sweepCodexHomesIfDue()
        expect(existsSync(logs)).toBe(true)

        vi.setSystemTime(Date.now() + 86_400_000)
        await sweepCodexHomesIfDue()
        expect(existsSync(logs)).toBe(false)
    })
})
