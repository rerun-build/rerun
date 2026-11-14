import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-update-'))
process.env.RERUN_API_KEY = ''

type FakeChild = EventEmitter & { unref: () => void; unrefCalled: boolean }

const spawned = vi.hoisted(() => [] as { command: string; args: string[]; options: { detached?: boolean; env?: Record<string, string | undefined> }; child: FakeChild }[])

vi.mock('node:child_process', async importOriginal => {
    const { EventEmitter: Emitter } = await import('node:events')
    return {
        ...(await importOriginal<typeof import('node:child_process')>()),
        spawn: (command: string, args: string[], options: (typeof spawned)[number]['options']) => {
            const child = Object.assign(new Emitter(), {
                unrefCalled: false,
                unref() {
                    child.unrefCalled = true
                },
            })
            spawned.push({ command, args, options, child })
            return child
        },
    }
})

const { describe, expect, it } = await import('vitest')
const { createServer } = await import('../server.js')
const { registerRunAbort, unregisterRunAbort } = await import('../../runtime/run-control.js')
const { buildCommit } = await import('../../runtime/build-info.js')
const { writeLastUpdate } = await import('../../runtime/last-update.js')

const app = createServer()

const SHA = 'a'.repeat(64)
const COMMIT = 'abc1234def5678abc1234def5678abc1234def56'
const ARTIFACT = { url: 'https://releases.example/engine/abc1234.tar.gz', sha256: SHA, commit: COMMIT, bytes: 1024 }

function update(body?: string) {
    return app.request('/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
}

describe('POST /update', () => {
    it('refuses while a run is in flight', async () => {
        registerRunAbort('busy-run', 'agent-1')
        const res = await update(JSON.stringify({}))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ started: false, reason: 'busy', activeRuns: 1 })
        expect(spawned).toHaveLength(0)
    })

    it('reads a body that is not JSON as no force', async () => {
        const res = await update('{oops')
        expect(await res.json()).toEqual({ started: false, reason: 'busy', activeRuns: 1 })
        expect(spawned).toHaveLength(0)
    })

    it('rejects a malformed artifact before looking at anything else', async () => {
        for (const artifact of [
            { ...ARTIFACT, url: 'http://releases.example/engine.tar.gz' },
            { ...ARTIFACT, sha256: 'abc' },
            { ...ARTIFACT, commit: 'v1.2.3' },
            { ...ARTIFACT, bytes: -1 },
            { url: ARTIFACT.url },
        ]) {
            const res = await update(JSON.stringify({ force: true, artifact }))
            expect(res.status).toBe(400)
            expect(await res.json()).toMatchObject({ error: expect.stringContaining('invalid update request') })
        }
        expect(spawned).toHaveLength(0)
    })

    it('starts a detached update when forced past the busy runs', async () => {
        const last = writeLastUpdate({ status: 'success', commit: 'old0000' })
        const res = await update(JSON.stringify({ force: true }))
        expect(res.status).toBe(202)
        expect(await res.json()).toEqual({ started: true, commit: buildCommit(), lastUpdate: last })

        expect(spawned).toHaveLength(1)
        const [{ command, args, options, child }] = spawned
        expect(command).toBe(process.execPath)
        expect(args).toEqual([process.argv[1], 'update'])
        expect(options.detached).toBe(true)
        expect(options.env?.CI).toBe('true')
        expect(child.unrefCalled).toBe(true)
        expect(existsSync(resolve(process.env.RERUN_DATA_DIR!, 'update.log'))).toBe(true)
        unregisterRunAbort('busy-run')
    })

    it('refuses a second update while the first is running', async () => {
        const res = await update(JSON.stringify({}))
        expect(await res.json()).toEqual({ started: false, reason: 'already-updating' })
        expect(spawned).toHaveLength(1)
    })

    it('can start again once the child failed to spawn', async () => {
        spawned[0].child.emit('error', new Error('ENOENT'))
        const res = await update()
        expect(res.status).toBe(202)
        expect(spawned).toHaveLength(2)
    })

    it('can start again once the updater gave up', async () => {
        expect(await (await update()).json()).toEqual({ started: false, reason: 'already-updating' })
        spawned[1].child.emit('exit', 1)
        const res = await update()
        expect(res.status).toBe(202)
        expect(spawned).toHaveLength(3)
        spawned[2].child.emit('exit', 0)
    })

    it('hands a prebuilt artifact to the updater as arguments', async () => {
        const res = await update(JSON.stringify({ artifact: ARTIFACT }))
        expect(res.status).toBe(202)
        expect(spawned).toHaveLength(4)
        expect(spawned[3].args).toEqual([process.argv[1], 'update', '--artifact', ARTIFACT.url, '--sha256', SHA, '--commit', COMMIT, '--bytes', '1024'])
        spawned[3].child.emit('exit', 0)
    })
})
