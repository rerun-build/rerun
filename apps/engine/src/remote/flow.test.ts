import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-remote-flow-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'
process.env.RERUN_DESKTOP = 'off'

const { afterAll, beforeAll, describe, expect, it, vi } = await import('vitest')
const { WebSocketServer } = await import('ws')
const { serializeComputerAccessDecision } = await import('@rerun/contracts')
const { createServer } = await import('../http/server.js')
const { migrate } = await import('../db/migrate.js')
const { acceptComputer } = await import('./socket.js')
const { forgetComputer, liveConnection } = await import('./registry.js')
const { upsertComputer } = await import('./store.js')
const { sessionClaimCount } = await import('../runtime/run-control.js')
const { connectFakeComputer } = await import('./__fixtures__/fake-computer.js')
const { startScriptedModel, computerCommandScript } = await import('./__fixtures__/scripted-model.mjs')

// The whole walk on the engine, with a scripted model behind a custom connection and a computer that
// speaks the real protocol: the coworker tries, is told it needs a yes, asks with the card, and runs
// the command once the person approves, as the person who asked.

const COMMAND = 'ffmpeg -i "Vidéos été 2026/day2.mov" teaser.mp4'
const studio = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
const app = createServer()
let model: Awaited<ReturnType<typeof startScriptedModel>>
let wss: InstanceType<typeof WebSocketServer>
let computer: Awaited<ReturnType<typeof connectFakeComputer>>
let agentId = ''

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function chat(message: string, sessionId?: string): Promise<string> {
    const res = await send('POST', `/agents/${agentId}/chat`, { message, sessionId, author: { id: 'u1', name: 'Claire' } })
    expect(res.status).toBe(200)
    await res.text()
    const id = res.headers.get('x-session-id')!
    // The run settles its messages right after the stream ends, then frees the conversation.
    await vi.waitFor(() => expect(sessionClaimCount()).toBe(0), { timeout: 10_000 })
    return id
}

type Part = { type: string; text?: string; toolName?: string; input?: unknown; output?: unknown }

// The history as the engine keeps it: AI SDK model messages, their parts in `contentJson`.
async function messagesOf(sessionId: string): Promise<{ role: string; parts: Part[] }[]> {
    const res = await send('GET', `/agents/${agentId}/sessions/${sessionId}/messages`)
    const { messages } = (await res.json()) as { messages: { role: string; contentJson: string }[] }
    return messages.map(message => {
        const content = JSON.parse(message.contentJson) as unknown
        return { role: message.role, parts: typeof content === 'string' ? [{ type: 'text', text: content }] : (content as Part[]) }
    })
}

const callsOf = (parts: Part[], toolName: string) => parts.filter(part => part.type === 'tool-call' && part.toolName === toolName)
const resultsOf = (parts: Part[], toolName: string) => parts.filter(part => part.type === 'tool-result' && part.toolName === toolName)

beforeAll(async () => {
    await migrate()
    model = await startScriptedModel(computerCommandScript({ computer: 'studio-pc', command: COMMAND, reason: 'Encode the teaser' }))
    const connection = await send('POST', '/connections', { name: 'Scripted', provider: 'custom', baseUrl: model.url, models: ['scripted'] })
    expect(connection.status).toBe(201)
    const { id: connectionId } = (await connection.json()) as { id: string }
    const agent = await send('POST', '/agents', { config: { name: 'editor', connectionId, provider: 'custom', model: 'scripted' } })
    expect(agent.status).toBe(201)
    agentId = ((await agent.json()) as { id: string }).id

    await upsertComputer(studio)
    wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => acceptComputer(ws, studio))
    await new Promise(done => wss.once('listening', done))
    computer = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, {
        handlers: { 'exec.run': ({ command }) => ({ exitCode: 0, stdout: `encoded ${command}\n`, stderr: '', truncated: false, timedOut: false, durationMs: 4200 }) },
    })
    await computer.welcome
    await vi.waitFor(() => expect(liveConnection('c1')).not.toBeNull())
}, 30_000)

afterAll(async () => {
    await computer?.close()
    await forgetComputer('c1')
    await new Promise(done => wss.close(done))
    await model.close()
})

describe('a coworker running a command on a linked computer', () => {
    let sessionId = ''

    it('offers the tools of the computer and names it in the prompt', async () => {
        sessionId = await chat('Encode the teaser on #studio-pc')
        const first = model.calls.find(call => call.tools.includes('remote_exec'))!
        expect(first.tools).toEqual(expect.arrayContaining(['remote_computers', 'remote_exec', 'request_computer_access']))
        const system = first.messages.filter((message: { role: string }) => message.role === 'system').map((message: { content: unknown }) => JSON.stringify(message.content)).join('\n')
        expect(system).toContain('#studio-pc (Studio PC): online, macOS with zsh, working folder /Users/claire/Rerun')
    }, 30_000)

    it('runs nothing before the yes, and stops on the card', async () => {
        expect(computer.requests).toEqual([])
        const messages = await messagesOf(sessionId)
        const parts = messages.flatMap(message => message.parts)
        expect(callsOf(parts, 'request_computer_access')[0]?.input).toMatchObject({ computer: '#studio-pc', commands: [COMMAND], reason: 'Encode the teaser' })
        expect(JSON.stringify(resultsOf(parts, 'remote_exec')[0]?.output)).toContain('needs_approval')
    }, 30_000)

    it('runs the exact command once the person approves, as the person who asked', async () => {
        await chat(serializeComputerAccessDecision({ computer: 'studio-pc', decision: 'approved' }), sessionId)
        expect(computer.requests.map(request => request.method)).toEqual(['exec.run'])
        expect(computer.requests[0].params).toMatchObject({ command: COMMAND, author: 'Claire' })
        const messages = await messagesOf(sessionId)
        const answer = messages.at(-1)!.parts.filter(part => part.type === 'text').map(part => part.text).join('')
        expect(messages.at(-1)!.role).toBe('assistant')
        expect(answer).toContain(`encoded ${COMMAND}`)
        expect(answer).toContain('#studio-pc · exit 0 · 4.2 s')
    }, 30_000)

    it('asks again for the next task: a yes covers the task it answered', async () => {
        await chat('Do it again', sessionId)
        expect(computer.requests).toHaveLength(1)
        const parts = (await messagesOf(sessionId)).flatMap(message => message.parts)
        expect(callsOf(parts, 'request_computer_access')).toHaveLength(2)
    }, 30_000)

    it('runs nothing after a no', async () => {
        await chat(serializeComputerAccessDecision({ computer: 'studio-pc', decision: 'declined' }), sessionId)
        expect(computer.requests).toHaveLength(1)
    }, 30_000)

    it('runs a program the person always allowed, without a card, in the next tasks', async () => {
        expect((await send('POST', '/remote/computers/c1/rules', { kind: 'program', program: 'ffmpeg' })).status).toBe(200)
        await chat(serializeComputerAccessDecision({ computer: 'studio-pc', decision: 'approved', always: 'ffmpeg' }), sessionId)
        expect(computer.requests).toHaveLength(2)
        await chat('And once more tomorrow', sessionId)
        expect(computer.requests).toHaveLength(3)
    }, 30_000)
})
