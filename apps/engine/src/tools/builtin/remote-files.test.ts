import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-remote-files-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'

const granted = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('../../remote/access.js', () => ({ commandGranted: async () => false, grantedPaths: async () => granted.paths }))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { WebSocketServer } = await import('ws')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { MAX_UPLOAD_FILE_BYTES } = await import('@rerun/contracts')
const { acceptComputer } = await import('../../remote/socket.js')
const { forgetComputer } = await import('../../remote/registry.js')
const { upsertComputer } = await import('../../remote/store.js')
const { remoteDir, workspaceDir } = await import('../../config/paths.js')
const { connectFakeComputer, FakeRemoteError } = await import('../../remote/__fixtures__/fake-computer.js')
const { remoteFileTools } = await import('./remote-files.js')

const studio = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
const AGENT = 'agent-files'
let wss: InstanceType<typeof WebSocketServer>
let fake: Awaited<ReturnType<typeof connectFakeComputer>> | null = null

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

async function run(name: string, input: Record<string, unknown>): Promise<unknown> {
    const tools = remoteFileTools({ agent: { id: AGENT }, sessionId: 's1', author: { id: 'u1', name: 'Claire' }, turnOrder: 'message-first' } as never)
    const t = tools[name] as { inputSchema: { parse: (v: unknown) => unknown }; execute: (input: unknown, options: unknown) => Promise<unknown> }
    return t.execute(t.inputSchema.parse(input), { toolCallId: 'x', messages: [] })
}

async function connect(handlers: Parameters<typeof connectFakeComputer>[1]['handlers'] = {}, capabilities: ('shell' | 'files')[] = ['shell', 'files']) {
    fake = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, { handlers, capabilities })
    await fake.welcome
    return fake
}

beforeEach(async () => {
    await rm(remoteDir(), { recursive: true, force: true })
    await rm(workspaceDir(AGENT), { recursive: true, force: true })
    await mkdir(workspaceDir(AGENT), { recursive: true })
    granted.paths = []
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

describe('the file tools of a linked computer', () => {
    it('lists the working folder, scoped to it, as the person who asked', async () => {
        const computer = await connect({ 'fs.list': ({ path }) => ({ path, entries: [{ name: 'Rushes', type: 'dir', size: 0, modifiedAt: null }, { name: 'teaser.mp4', type: 'file', size: 84 * 1024 * 1024, modifiedAt: null }], truncated: false }) })
        expect(await run('remote_file_list', { computer: '#studio-pc' })).toBe('/Users/claire/Rerun on #studio-pc\nRushes/\nteaser.mp4  84.0 MB')
        expect(computer.requests[0].params).toEqual({ path: '/Users/claire/Rerun', author: 'Claire', roots: ['/Users/claire/Rerun'], sensitiveOk: false })
    })

    it('asks before going outside the allowed folders, and always where secrets live', async () => {
        const computer = await connect()
        expect(await run('remote_file_read', { computer: '#studio-pc', path: '/Users/claire/Movies/a.txt' })).toMatchObject({ status: 'needs_approval' })
        const sensitive = (await run('remote_file_read', { computer: '#studio-pc', path: '~/.ssh/config' })) as { instruction: string }
        expect(sensitive.instruction).toContain('where secrets live')
        expect(computer.requests).toEqual([])
    })

    it('goes where the person said yes, and says yes to a secret only when they did', async () => {
        granted.paths = ['~/.ssh/config']
        const computer = await connect({ 'fs.read': ({ path }) => ({ path, content: 'Host x', encoding: 'utf8', size: 6, truncated: false }) })
        expect(await run('remote_file_read', { computer: '#studio-pc', path: '~/.ssh/config' })).toBe('/Users/claire/.ssh/config on #studio-pc · 6 B\nHost x')
        expect(computer.requests[0].params).toMatchObject({ sensitiveOk: true, roots: ['/Users/claire/Rerun', '~/.ssh/config'] })
    })

    it('describes a binary file instead of pouring it into the conversation', async () => {
        await connect({ 'fs.read': ({ path }) => ({ path, content: 'AAAA', encoding: 'base64', size: 3_000_000, truncated: true }) })
        expect(await run('remote_file_read', { computer: '#studio-pc', path: 'day2.mov' })).toMatch(/is a binary file of 2.9 MB/)
    })

    it('writes a text file there', async () => {
        const computer = await connect({ 'fs.write': ({ path, content }) => ({ path, size: String(content).length }) })
        expect(await run('remote_file_write', { computer: '#studio-pc', path: 'list.txt', content: 'a\nb' })).toBe('Wrote /Users/claire/Rerun/list.txt on #studio-pc (3 B).')
        expect(computer.requests[0].params).toMatchObject({ encoding: 'utf8', content: 'a\nb' })
    })

    it('does nothing on a computer whose owner switched its files off', async () => {
        await connect({}, ['shell'])
        expect(await run('remote_file_list', { computer: '#studio-pc' })).toMatch(/does not offer its files/)
    })

    it('reads back a refusal of the computer itself', async () => {
        await connect({
            'fs.list': () => {
                throw new FakeRemoteError('outside_workdir', '/x is outside the folders coworkers may use on this computer.')
            },
        })
        expect(await run('remote_file_list', { computer: '#studio-pc', path: 'link-out' })).toMatch(/refused or failed: \/x is outside/)
    })
})

describe('remote_transfer', () => {
    const big = Buffer.alloc(2.5 * 1024 * 1024, 5)

    function pullHandlers(data: Buffer, digest = sha(data)) {
        return {
            'fs.stat': ({ path }: Record<string, unknown>) => ({ path, entry: { name: 'teaser.mp4', type: 'file', size: data.length, modifiedAt: null } }),
            'fs.pull': ({ path, offset }: Record<string, unknown>) => {
                const start = offset as number
                const piece = data.subarray(start, start + 1024 * 1024)
                const eof = start + piece.length >= data.length
                return { path, size: data.length, data: piece.toString('base64'), eof, sha256: eof ? digest : null }
            },
        }
    }

    it('brings a file into the workspace in pieces and checks it arrived whole', async () => {
        const computer = await connect(pullHandlers(big))
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_workspace', from: 'Exports/teaser.mp4' })).toBe('Copied /Users/claire/Rerun/Exports/teaser.mp4 from #studio-pc to teaser.mp4 in your workspace (2.5 MB).')
        expect((await readFile(resolve(workspaceDir(AGENT), 'teaser.mp4'))).equals(big)).toBe(true)
        expect(computer.requests.filter(request => request.method === 'fs.pull').map(request => request.params.offset)).toEqual([0, 1024 * 1024, 2 * 1024 * 1024])
    })

    it('leaves nothing behind when the file arrives damaged', async () => {
        await connect(pullHandlers(big, sha(Buffer.from('else'))))
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_workspace', from: 'teaser.mp4', to: 'in/teaser.mp4' })).toMatch(/damaged/)
        await expect(readFile(resolve(workspaceDir(AGENT), 'in', 'teaser.mp4'))).rejects.toThrow()
    })

    it('leaves a file over the limit on the computer', async () => {
        const computer = await connect({ 'fs.stat': ({ path }) => ({ path, entry: { name: 'day2.mov', type: 'file', size: MAX_UPLOAD_FILE_BYTES + 1, modifiedAt: null } }) })
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_workspace', from: 'day2.mov' })).toMatch(/stays on #studio-pc/)
        expect(computer.requests.map(request => request.method)).toEqual(['fs.stat'])
    })

    it('sends a workspace file to the computer in pieces, the last one with its sha256', async () => {
        await writeFile(resolve(workspaceDir(AGENT), 'music.wav'), big)
        const received: Buffer[] = []
        const computer = await connect({
            'fs.push': ({ path, data, final, sha256 }) => {
                received.push(Buffer.from(String(data), 'base64'))
                if (final) expect(sha256).toBe(sha(big))
                return { path, size: Buffer.concat(received).length, done: final }
            },
        })
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_computer', from: 'music.wav', to: 'Audio/music.wav' })).toBe('Copied music.wav to /Users/claire/Rerun/Audio/music.wav on #studio-pc (2.5 MB).')
        expect(Buffer.concat(received).equals(big)).toBe(true)
        expect(computer.requests.map(request => [request.params.offset, request.params.final])).toEqual([
            [0, false],
            [1024 * 1024, false],
            [2 * 1024 * 1024, true],
        ])
    })

    it('sends an empty file as one final piece, and says when the workspace has no such file', async () => {
        await writeFile(resolve(workspaceDir(AGENT), 'empty.txt'), '')
        const computer = await connect({ 'fs.push': ({ path, final }) => ({ path, size: 0, done: final }) })
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_computer', from: 'empty.txt' })).toMatch(/^Copied empty.txt/)
        expect(computer.requests).toHaveLength(1)
        expect(await run('remote_transfer', { computer: '#studio-pc', direction: 'to_computer', from: 'nope.txt' })).toBe('No file at nope.txt in your workspace.')
    })
})
