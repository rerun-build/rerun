import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-remote-tools-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'

const granted = vi.hoisted(() => ({ commands: new Set<string>() }))
vi.mock('../../remote/access.js', () => ({ commandGranted: async (_ctx: unknown, computer: string, command: string) => granted.commands.has(`${computer}:${command}`) }))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { WebSocketServer } = await import('ws')
const { rm } = await import('node:fs/promises')
const { acceptComputer } = await import('../../remote/socket.js')
const { forgetComputer, liveConnection } = await import('../../remote/registry.js')
const { upsertComputer } = await import('../../remote/store.js')
const { remoteDir } = await import('../../config/paths.js')
const { connectFakeComputer, FakeRemoteError } = await import('../../remote/__fixtures__/fake-computer.js')
const { remoteComputerTools } = await import('./remote.js')

type Fake = Awaited<ReturnType<typeof connectFakeComputer>>

const studio = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
let wss: InstanceType<typeof WebSocketServer>
let fake: Fake | null = null

const ctx = (abortSignal?: AbortSignal, unattended = false) => ({ agent: { id: 'a1' }, sessionId: 's1', author: { id: 'u1', name: 'Claire' }, turnOrder: 'message-first', abortSignal, unattended }) as never

async function run(name: string, input: Record<string, unknown>, abortSignal?: AbortSignal, unattended = false): Promise<unknown> {
    const tools = remoteComputerTools(ctx(abortSignal, unattended))
    const tool = tools[name] as { inputSchema: { parse: (v: unknown) => unknown }; execute: (input: unknown, options: unknown) => Promise<unknown> }
    return tool.execute((tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input), { toolCallId: 'x', messages: [] })
}

async function connect(options: Parameters<typeof connectFakeComputer>[1] = {}): Promise<Fake> {
    fake = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, options)
    await fake.welcome
    return fake
}

beforeEach(async () => {
    await rm(remoteDir(), { recursive: true, force: true })
    granted.commands.clear()
    wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => acceptComputer(ws, studio))
    await new Promise(done => wss.once('listening', done))
    await upsertComputer(studio)
})

afterEach(async () => {
    await fake?.close()
    fake = null
    await forgetComputer('c1')
    await new Promise(done => wss.close(done))
})

const ran = (command: string, extra: Record<string, unknown> = {}) => ({ exitCode: 0, stdout: `ran ${command}\n`, stderr: '', truncated: false, timedOut: false, durationMs: 1234, ...extra })

describe('remote_computers', () => {
    it('lists each computer with what the coworker needs to pick one', async () => {
        await connect({ facts: { gpus: ['NVIDIA RTX 4090'], memoryBytes: 64 * 1024 ** 3 } })
        await upsertComputer({ id: 'c2', handle: 'laptop', name: 'Laptop' })
        const { computers } = (await run('remote_computers', {})) as { computers: Record<string, unknown>[] }
        expect(computers[0]).toMatchObject({ computer: '#studio-pc', status: 'online', os: 'macOS 15.1', shell: 'zsh', workingFolder: '/Users/claire/Rerun', gpus: ['NVIDIA RTX 4090'], memoryGB: 64, offers: ['shell', 'files', 'jobs'] })
        expect(computers[1]).toMatchObject({ computer: '#laptop', status: 'offline' })
        await forgetComputer('c2')
    })
})

describe('remote_exec', () => {
    it('asks for the yes first, and runs nothing before it', async () => {
        const computer = await connect({ handlers: { 'exec.run': ({ command }) => ran(String(command)) } })
        const answer = (await run('remote_exec', { computer: '#studio-pc', command: 'ffmpeg -version' })) as { status: string; instruction: string }
        expect(answer.status).toBe('needs_approval')
        expect(answer.instruction).toContain('request_computer_access')
        expect(computer.requests).toEqual([])
    })

    it('runs an approved command there, as the person who asked, and reads back what it printed', async () => {
        const computer = await connect({ handlers: { 'exec.run': ({ command }) => ran(String(command), { stderr: 'warning' }) } })
        granted.commands.add('studio-pc:ffmpeg -version')
        const text = (await run('remote_exec', { computer: 'studio-pc', command: 'ffmpeg -version', cwd: 'Rushes', timeoutSeconds: 30 })) as string
        expect(text).toBe('#studio-pc · exit 0 · 1.2 s\nran ffmpeg -version\n\n[stderr]\nwarning')
        expect(computer.requests[0]).toMatchObject({ method: 'exec.run', params: { command: 'ffmpeg -version', cwd: 'Rushes', timeoutMs: 30_000, author: 'Claire' } })
    })

    it('says when a command timed out or its output was trimmed', async () => {
        await connect({ handlers: { 'exec.run': () => ran('x', { timedOut: true, exitCode: null, truncated: true, stdout: '' }) } })
        granted.commands.add('studio-pc:make')
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'make', timeoutSeconds: 5 })).toBe('Timed out after 5 s and was stopped on #studio-pc · output trimmed in the middle\n(no output)')
    })

    it('never sends what raises privileges or wipes a disk, approved or not', async () => {
        const computer = await connect()
        granted.commands.add('studio-pc:sudo rm -rf /tmp/x')
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'sudo rm -rf /tmp/x' })).toMatch(/^Not run: it asks for administrator rights/)
        expect(computer.requests).toEqual([])
    })

    it('names the computers it knows when asked for one it does not, and says when there is none', async () => {
        expect(await run('remote_exec', { computer: '#nope', command: 'ls' })).toBe('No computer is called #nope. The linked ones: #studio-pc.')
        await forgetComputer('c1')
        expect(await run('remote_exec', { computer: '#nope', command: 'ls' })).toMatch(/^No computer is linked/)
    })

    it('runs nothing on a computer that is offline or paused, and says so', async () => {
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ls' })).toMatch(/^#studio-pc is offline/)
        const computer = await connect({ paused: true })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ls' })).toMatch(/^#studio-pc is paused by its owner/)
        expect(computer.requests).toEqual([])
    })

    it('reads a refusal of the computer back to the coworker', async () => {
        await connect({
            handlers: {
                'exec.run': () => {
                    throw new FakeRemoteError('not_found', 'No folder at /x on this computer.')
                },
            },
        })
        granted.commands.add('studio-pc:ls')
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ls', cwd: '/x' })).toBe('No folder at /x on this computer.')
    })

    it('says the command may have run when the computer drops in the middle', async () => {
        const computer = await connect({ handlers: { 'exec.run': () => new Promise(() => {}) } })
        granted.commands.add('studio-pc:sleep 100')
        const running = run('remote_exec', { computer: '#studio-pc', command: 'sleep 100' })
        await vi.waitFor(() => expect(computer.requests).toHaveLength(1))
        computer.ws.terminate()
        expect(await running).toMatch(/went offline before it answered/)
    })

    it('stops the command on the computer when the run is stopped', async () => {
        const computer = await connect({ handlers: { 'exec.run': () => new Promise(() => {}), 'exec.cancel': () => ({ cancelled: true }) } })
        granted.commands.add('studio-pc:sleep 100')
        const abort = new AbortController()
        const running = run('remote_exec', { computer: '#studio-pc', command: 'sleep 100' }, abort.signal)
        await vi.waitFor(() => expect(computer.requests).toHaveLength(1))
        abort.abort()
        await expect(running).rejects.toMatchObject({ code: 'cancelled' })
        await vi.waitFor(() => expect(computer.requests.map(request => request.method)).toEqual(['exec.run', 'exec.cancel']))
        expect(computer.requests[1].params).toEqual({ execId: computer.requests[0].params.execId })
        expect(liveConnection('c1')).not.toBeNull()
    })
})

describe('the rules of the computer', () => {
    const handlers = { 'exec.run': ({ command }: Record<string, unknown>) => ran(String(command)) }

    it('runs a program the owner always allowed without a card, and asks for any other', async () => {
        await upsertComputer(studio, { allowedPrograms: ['ffmpeg', 'ffprobe'] })
        const computer = await connect({ handlers })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffprobe a.mov | ffmpeg -i - b.mp4' })).toMatch(/^#studio-pc · exit 0/)
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffprobe a.mov | python3 x.py' })).toMatchObject({ status: 'needs_approval' })
        expect(computer.requests).toHaveLength(1)
    })

    it('asks every time for a command that hides what it runs, and says why', async () => {
        await upsertComputer(studio, { allowedPrograms: ['bash', 'ffmpeg'] })
        await connect({ handlers })
        const answer = (await run('remote_exec', { computer: '#studio-pc', command: 'bash -c "ffmpeg -i a b"' })) as { instruction: string }
        expect(answer.instruction).toContain('asks every time')
    })

    it('asks for every command on "ask every time", and for none on "full access"', async () => {
        await upsertComputer(studio, { mode: 'ask', allowedPrograms: ['ffmpeg'] })
        const computer = await connect({ handlers })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffmpeg -version' })).toMatchObject({ status: 'needs_approval' })
        await upsertComputer(studio, { mode: 'full' })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'bash -c "make"' })).toMatch(/^#studio-pc · exit 0/)
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'sudo make install' })).toMatch(/^Not run: it asks for administrator rights/)
        expect(computer.requests).toHaveLength(1)
    })

    it('takes no work without someone in the chat when its owner said so', async () => {
        await upsertComputer(studio, { allowedPrograms: ['ffmpeg'], unattended: false })
        const computer = await connect({ handlers })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffmpeg -version' }, undefined, true)).toMatch(/only takes work while someone is in the chat/)
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffmpeg -version' })).toMatch(/^#studio-pc · exit 0/)
        await upsertComputer(studio, { unattended: true })
        expect(await run('remote_exec', { computer: '#studio-pc', command: 'ffmpeg -version' }, undefined, true)).toMatch(/^#studio-pc · exit 0/)
        expect(computer.requests).toHaveLength(2)
    })
})

describe('request_computer_access', () => {
    it('is a card: it hands back the delivery note and what "Always allow" would keep there', async () => {
        await connect()
        const result = (await run('request_computer_access', { computer: '#studio-pc', reason: 'Encode', commands: ['ffmpeg -i a.mov a.mp4'] })) as { status: string; card: unknown }
        expect(result.status).toBe('delivered')
        expect(result.card).toEqual({ computerId: 'c1', always: { rule: 'program', value: 'ffmpeg', interpreter: false } })
        const byPath = (await run('request_computer_access', { computer: '#studio-pc', reason: 'Encode', commands: ['/usr/local/bin/ffmpeg -i a.mov a.mp4'] })) as { card: unknown }
        expect(byPath.card).toEqual({ computerId: 'c1', always: null })
    })

    it('offers to keep the folder of files outside the allowed ones, never a place where secrets live', async () => {
        await connect()
        expect(((await run('request_computer_access', { computer: '#studio-pc', reason: 'x', paths: ['/Volumes/Rushes/day2.mov', '/Volumes/Rushes/day3.mov'] })) as { card: unknown }).card).toEqual({ computerId: 'c1', always: { rule: 'folder', value: '/Volumes/Rushes', interpreter: false } })
        expect(((await run('request_computer_access', { computer: '#studio-pc', reason: 'x', paths: ['~/.ssh/config'] })) as { card: unknown }).card).toEqual({ computerId: 'c1', always: null })
        expect(((await run('request_computer_access', { computer: '#studio-pc', reason: 'x', paths: ['/a/x', '/b/y'] })) as { card: unknown }).card).toEqual({ computerId: 'c1', always: null })
    })

    it('offers no "always" where the owner keeps no rules, for an opaque command, or for an unknown computer', async () => {
        await upsertComputer(studio, { mode: 'ask' })
        expect(((await run('request_computer_access', { computer: '#studio-pc', reason: 'x', commands: ['ffmpeg -version'] })) as { card: unknown }).card).toEqual({ computerId: 'c1', always: null })
        await upsertComputer(studio, { mode: 'remember' })
        expect(((await run('request_computer_access', { computer: '#studio-pc', reason: 'x', commands: ['sh -c ls'] })) as { card: unknown }).card).toEqual({ computerId: 'c1', always: null })
        expect(((await run('request_computer_access', { computer: '#nope', reason: 'x', commands: ['ls'] })) as { card: unknown }).card).toEqual({ computerId: null, always: null })
    })
})
