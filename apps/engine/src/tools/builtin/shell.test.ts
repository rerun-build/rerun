import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-shell-'))

const { describe, expect, it, vi } = await import('vitest')
const { HostBreaker, BLOCKED_SOURCE_PREFIX } = await import('../host-breaker.js')
const { shellTools } = await import('./shell.js')

type Runner = Parameters<typeof shellTools>[1]

function ctxWith() {
    return { agent: { id: 'shell', env: {}, config: { tools: {} } }, sessionId: 's', logger: { warn: () => {} }, hostBreaker: new HostBreaker() } as any
}

async function exec(ctx: ReturnType<typeof ctxWith>, run: Runner, command: string): Promise<string> {
    return (await (shellTools(ctx, run).shell_exec as any).execute({ command, timeoutMs: 120_000 }, { toolCallId: 'call-1', messages: [] })) as string
}

function failure(code: number, stderr: string): Error {
    return Object.assign(new Error(`Command failed: get('https://example.com') except ConnectionError\n${stderr}`), { code, stdout: '', stderr, killed: false, signal: null })
}

describe('shell_exec', () => {
    it('closes a host whose curl keeps answering 403 even though curl exits 0', async () => {
        const run = vi.fn(async () => ({ stdout: 'HTTP/2 403 \ncontent-type: text/html\n', stderr: '' }))
        const ctx = ctxWith()
        expect(await exec(ctx, run, 'curl -i https://www.reddit.com/r/startups.json')).toContain('[attempt 1/3 on reddit.com failed in this run]')
        await exec(ctx, run, 'curl -i -A "Mozilla" https://reddit.com/r/startups.json')
        expect(await exec(ctx, run, 'curl -s https://www.reddit.com/r/startups/')).toContain(BLOCKED_SOURCE_PREFIX)
        expect(await exec(ctx, run, 'curl -s https://reddit.com/r/startups/')).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX} reddit.com`))
        expect(run).toHaveBeenCalledTimes(3)
    })

    it('leaves a site open when two of the three failures never reached the network', async () => {
        const script = (interpreter: string) => `${interpreter} - <<'PY'\nimport requests, bs4\nrequests.get('https://example.com/sitemap.xml')\nPY`
        const run = vi.fn().mockRejectedValueOnce(failure(127, '/bin/sh: 1: python: not found\n')).mockRejectedValueOnce(failure(1, 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nModuleNotFoundError: No module named \'bs4\'\n')).mockRejectedValueOnce(failure(1, "requests.exceptions.ConnectionError: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))\n")).mockResolvedValueOnce({ stdout: '200\n', stderr: '' })
        const ctx = ctxWith()
        expect(await exec(ctx, run, script('python'))).not.toContain('[attempt')
        expect(await exec(ctx, run, script('python3'))).not.toContain('[attempt')
        expect(await exec(ctx, run, script('python3'))).toContain('[attempt 1/3 on example.com failed in this run]')
        expect(await exec(ctx, run, script('python3'))).toBe('200\n')
        expect(run).toHaveBeenCalledTimes(4)
    })

    it.each([
        ['a missing program', 'nope https://example.com', failure(127, '/bin/sh: nope: command not found\n')],
        ['a missing module', `python3 -c "import x; get('https://example.com')"`, failure(1, "ModuleNotFoundError: No module named 'x'\n")],
        ['a grep that matches nothing', 'curl -s https://example.com | grep nothing', failure(1, '')],
        ['a script that only handles network errors', `python3 -c "try: get('https://example.com')\nexcept ConnectionError: (("`, failure(1, '  File "<string>", line 2\n    except ConnectionError: ((\n                             ^\nSyntaxError: \'(\' was never closed\n')],
        ['a missing page', 'curl -sSf https://example.com/sitemap.xml', failure(22, 'curl: (22) The requested URL returned error: 404\n')],
    ])('never closes a site on %s', async (_, command, error) => {
        const run = vi.fn(async () => {
            throw error
        })
        const ctx = ctxWith()
        for (let i = 0; i < 5; i++) expect(await exec(ctx, run, command)).not.toContain('example.com failed in this run')
        expect(run).toHaveBeenCalledTimes(5)
    })

    it('does not let a local failure reset the streak of a site that refuses', async () => {
        const run = vi.fn()
        const refused = { stdout: 'HTTP/2 403 \n', stderr: '' }
        run.mockResolvedValueOnce(refused).mockResolvedValueOnce(refused).mockRejectedValueOnce(failure(127, 'nope: not found')).mockResolvedValueOnce(refused)
        const ctx = ctxWith()
        for (let i = 0; i < 3; i++) await exec(ctx, run, 'curl -i https://example.com')
        expect(await exec(ctx, run, 'curl -i https://example.com')).toContain(`${BLOCKED_SOURCE_PREFIX} example.com`)
    })

    it.each([
        ['a silent curl that cannot connect', failure(7, '')],
        ['a command that times out', Object.assign(failure(0, ''), { killed: true, signal: 'SIGTERM' })],
    ])('still closes a site on %s', async (_, error) => {
        const run = vi.fn(async () => {
            throw error
        })
        const ctx = ctxWith()
        for (let i = 0; i < 3; i++) await exec(ctx, run, 'curl -s https://example.com')
        expect(await exec(ctx, run, 'curl -s https://example.com')).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX} example.com`))
        expect(run).toHaveBeenCalledTimes(3)
    })

    it('never touches the breaker for a command without a URL', async () => {
        const run = vi.fn(async () => {
            throw Object.assign(new Error('Command failed: ls nowhere'), { stdout: '', stderr: 'ls: nowhere: No such file' })
        })
        const ctx = ctxWith()
        for (let i = 0; i < 5; i++) expect(await exec(ctx, run, 'ls nowhere')).toMatch(/^Command failed: /)
        expect(run).toHaveBeenCalledTimes(5)
    })

    it('says when a command was killed on timeout', async () => {
        const run = vi.fn(async () => {
            throw Object.assign(new Error('Command failed: sleep 999'), { killed: true, signal: 'SIGTERM', stdout: '', stderr: '' })
        })
        expect(await exec(ctxWith(), run, 'sleep 999')).toMatch(/^Command timed out after 120 s and was killed/)
    })

    it('returns the output of a working command', async () => {
        const run = vi.fn(async () => ({ stdout: 'hello\n', stderr: '' }))
        expect(await exec(ctxWith(), run, 'echo hello')).toBe('hello\n')
    })
})
