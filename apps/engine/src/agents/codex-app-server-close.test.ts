import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamText } from 'ai'
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli'
import { afterEach, describe, expect, it } from 'vitest'

const sigtermDeafServer = fileURLToPath(new URL('./__fixtures__/fake-codex-app-server-sigterm-deaf.mjs', import.meta.url))

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

async function runOneTurn(env: Record<string, string> = {}) {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'codex-close-')), 'pid')
    const provider = createCodexAppServer({ defaultSettings: { codexPath: sigtermDeafServer, env: { PID_FILE: pidFile, ...env }, minCodexVersion: '0.144.0', logger: false } })
    await streamText({ model: provider('gpt-5.6-sol'), prompt: 'hello' }).consumeStream()
    return { provider, pid: Number(readFileSync(pidFile, 'utf8')) }
}

// A Codex app-server left running keeps its thread's writer lock, and the next turn's resume of that
// thread is refused with "already has an active writer" (RER-128).
describe('closing the codex app-server', () => {
    let pid: number | undefined

    afterEach(() => {
        if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL')
        pid = undefined
    })

    it('stops a process that ignores SIGTERM, as when the kill is refused', async () => {
        const turn = await runOneTurn()
        pid = turn.pid
        expect(isAlive(pid)).toBe(true)

        await turn.provider.close()

        expect(isAlive(pid)).toBe(false)
    }, 15_000)

    // The run caps this wait, and starts the next turn on a new thread when the cap runs out.
    it('returns only once the process is gone', async () => {
        const turn = await runOneTurn({ STAY_AFTER_EOF: '1' })
        pid = turn.pid
        let closed = false
        const closing = turn.provider.close().then(() => (closed = true))

        await new Promise(resolve => setTimeout(resolve, 500))
        expect(closed).toBe(false)
        expect(isAlive(pid)).toBe(true)

        process.kill(pid, 'SIGKILL')
        await closing
        expect(isAlive(pid)).toBe(false)
    }, 15_000)
})
