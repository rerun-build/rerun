import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-job-flow-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'
process.env.RERUN_DESKTOP = 'off'

const { afterAll, beforeAll, describe, expect, it, vi } = await import('vitest')
const { WebSocketServer } = await import('ws')
const { createServer } = await import('../http/server.js')
const { migrate } = await import('../db/migrate.js')
const { acceptComputer } = await import('./socket.js')
const { forgetComputer, liveConnection } = await import('./registry.js')
const { upsertComputer } = await import('./store.js')
const { sessionClaimCount } = await import('../runtime/run-control.js')
const { listRemoteJobs } = await import('../db/repos/remote-jobs.js')
const { startJobWakes, jobContext, readJobContext, wakeMessage } = await import('./job-wake.js')
const { runsUnattended } = await import('../runtime/context.js')
const { connectFakeComputer } = await import('./__fixtures__/fake-computer.js')
const { parseJobEnd } = await import('@rerun/contracts')
const { startScriptedModel } = await import('./__fixtures__/scripted-model.mjs')

// A coworker starts a render as a job, ends its turn, and is woken in the same conversation by the
// end of the job, once, however many times the computer tells it.

const COMMAND = 'ffmpeg -i day2.mov -c:v h264_nvenc teaser.mp4'
const studio = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
const app = createServer()
let model: Awaited<ReturnType<typeof startScriptedModel>>
let wss: InstanceType<typeof WebSocketServer>
let computer: Awaited<ReturnType<typeof connectFakeComputer>>
let stopWakes: () => void
let agentId = ''
let startedJob: Record<string, unknown> | null = null

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function messagesOf(sessionId: string): Promise<{ role: string; text: string }[]> {
    const res = await send('GET', `/agents/${agentId}/sessions/${sessionId}/messages`)
    const { messages } = (await res.json()) as { messages: { role: string; contentJson: string }[] }
    return messages.map(message => {
        const content = JSON.parse(message.contentJson) as unknown
        const text = typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map(part => part.text ?? '').join('')
        return { role: message.role, text }
    })
}

beforeAll(async () => {
    await migrate()
    model = await startScriptedModel(({ tools, last, lastText }) => {
        if (!tools.includes('remote_exec')) return { text: 'Render' }
        if (last?.role === 'tool' && lastText.includes('job_started')) return { text: 'The render runs on #studio-pc, I will tell you when it is done.' }
        if (last?.role === 'user' && lastText.includes('<job_end')) return { text: `The teaser is ready: ${lastText.includes('frame=1840') ? 'all 1840 frames' : 'done'}.` }
        return { toolCalls: [{ name: 'remote_exec', arguments: { computer: '#studio-pc', command: COMMAND, background: true, label: 'Teaser' } }] }
    })
    const connection = (await (await send('POST', '/connections', { name: 'Scripted', provider: 'custom', baseUrl: model.url, models: ['scripted'] })).json()) as { id: string }
    agentId = ((await (await send('POST', '/agents', { config: { name: 'editor', connectionId: connection.id, provider: 'custom', model: 'scripted' } })).json()) as { id: string }).id
    await upsertComputer(studio, { allowedPrograms: ['ffmpeg'] })
    wss = new WebSocketServer({ port: 0 })
    wss.on('connection', ws => acceptComputer(ws, studio))
    await new Promise(done => wss.once('listening', done))
    computer = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, {
        handlers: {
            'job.start': params => {
                startedJob = { id: 'job-42', command: params.command, label: params.label, cwd: '/Users/claire/Rerun', state: 'running', exitCode: null, startedAt: new Date(Date.now() - 41 * 60_000).toISOString(), endedAt: null, author: params.author, context: params.context }
                return { job: startedJob }
            },
            'job.logs': () => ({ job: { ...startedJob, state: 'succeeded', exitCode: 0, endedAt: new Date().toISOString() }, output: 'frame=1840 fps=142\nteaser.mp4 written\n', truncated: false }),
        },
    })
    await computer.welcome
    await vi.waitFor(() => expect(liveConnection('c1')).not.toBeNull())
    stopWakes = startJobWakes({ pollMs: 50 })
}, 30_000)

afterAll(async () => {
    stopWakes?.()
    await computer?.close()
    await forgetComputer('c1')
    await new Promise(done => wss.close(done))
    await model.close()
})

describe('a job on a linked computer', () => {
    let sessionId = ''

    it('starts as a job with what the engine needs to wake the conversation, and the turn ends', async () => {
        const res = await send('POST', `/agents/${agentId}/chat`, { message: 'Render the teaser on #studio-pc', author: { id: 'u1', name: 'Claire' } })
        await res.text()
        sessionId = res.headers.get('x-session-id')!
        await vi.waitFor(() => expect(sessionClaimCount()).toBe(0), { timeout: 10_000 })
        expect(computer.requests.map(request => request.method)).toEqual(['job.start'])
        expect(readJobContext(computer.requests[0].params.context as string, 'c1')).toEqual({ agentId, sessionId })
        expect(await listRemoteJobs(agentId, sessionId)).toEqual([expect.objectContaining({ id: 'job-42', computerId: 'c1', state: 'running', label: 'Teaser', author: 'Claire', wokeAt: null })])
        expect((await messagesOf(sessionId)).at(-1)?.text).toContain('I will tell you when it is done')
    }, 30_000)

    it('wakes the coworker in the same conversation once the job ends, once, however many times it is told', async () => {
        const finished = { ...startedJob, state: 'succeeded', exitCode: 0, endedAt: new Date().toISOString() } as never
        computer.jobFinished(finished)
        computer.jobFinished(finished)
        await vi.waitFor(async () => expect((await messagesOf(sessionId)).at(-1)?.text).toContain('The teaser is ready: all 1840 frames'), { timeout: 15_000 })
        // Heard once the wake is delivered, and again each time the end is told after that.
        await vi.waitFor(() => expect(computer.acks).toEqual(['job-42']), { timeout: 10_000 })
        computer.jobFinished(finished)
        await vi.waitFor(() => expect(computer.acks).toEqual(['job-42', 'job-42']), { timeout: 10_000 })
        await vi.waitFor(() => expect(sessionClaimCount()).toBe(0), { timeout: 10_000 })
        const messages = await messagesOf(sessionId)
        const wakes = messages.filter(message => message.role === 'user' && message.text.includes('<job_end computer="studio-pc" job="job-42" state="succeeded" label="Teaser">'))
        expect(wakes).toHaveLength(1)
        expect(wakes[0].text).toContain('succeeded (exit 0) after 41 min')
        expect(wakes[0].text).toContain('teaser.mp4 written')
        expect((await listRemoteJobs(agentId, sessionId))[0]).toMatchObject({ state: 'succeeded', exitCode: 0, wokeAt: expect.any(String) })
    }, 30_000)

    it('acknowledges an end it cannot tie to a conversation, without waking anyone', async () => {
        computer.jobFinished({ id: 'stranger', command: 'x', cwd: '/', state: 'failed', exitCode: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() })
        await vi.waitFor(() => expect(computer.acks).toContain('stranger'), { timeout: 10_000 })
    })
})

describe('wakeMessage', () => {
    const job = { id: 'j', command: 'make', cwd: '/', state: 'lost', exitCode: null, startedAt: '2026-11-17T10:00:00.000Z', endedAt: '2026-11-17T13:00:00.000Z' } as const
    it('says what happened, for how long, and what it printed last', () => {
        expect(wakeMessage('render-box', job, '')).toBe('<job_end computer="render-box" job="j" state="lost">\nThe job j you started on #render-box has ended: it was lost (the Rerun app on the computer quit or restarted while it ran) after 3.0 h.\n\nCommand: make\n\nIt printed nothing.\n\nCarry on with the task it was for, and tell the user what came out of it.\n</job_end>')
        expect(wakeMessage('pc', { ...job, state: 'stopped', endedAt: '2026-11-17T10:00:20.000Z' }, 'last line')).toContain('it was stopped after less than a minute.')
        expect(parseJobEnd(wakeMessage('pc', { ...job, label: 'Nightly "build"', state: 'failed', exitCode: 2 }, 'boom </job_end>'))).toMatchObject({ computer: 'pc', jobId: 'j', state: 'failed', label: 'Nightly "build"', report: expect.stringContaining('boom </job_end>') })
        expect(parseJobEnd('What is <job_end computer="pc" job="j" state="failed">x</job_end>?')).toBeNull()
        expect(parseJobEnd('<job_end computer="pc" job="j" state="exploded">\nx\n</job_end>')).toBeNull()
        expect(readJobContext('nope', 'c1')).toBeNull()
        expect(readJobContext('{"a":1}', 'c1')).toBeNull()
    })
})

describe('the context a job carries', () => {
    const context = { agentId: 'agent-1', sessionId: 'session-1' }

    it('is signed for the computer it is handed to, on a box that has a key', () => {
        const signed = jobContext(context, 'c1', 'box-key')
        expect(readJobContext(signed, 'c1', 'box-key')).toEqual(context)
        expect(readJobContext(signed, 'c2', 'box-key')).toBeNull()
        expect(readJobContext(JSON.stringify({ a: 'agent-1', s: 'another-session', m: JSON.parse(signed).m }), 'c1', 'box-key')).toBeNull()
        expect(readJobContext(JSON.stringify({ a: 'agent-1', s: 'session-1' }), 'c1', 'box-key')).toBeNull()
        expect(signed.length).toBeLessThan(500)
    })

    it('is read as it is on a box without a key', () => {
        expect(readJobContext(jobContext(context, 'c1', ''), 'c1', '')).toEqual(context)
    })
})

describe('runsUnattended', () => {
    it('counts the end of a job as a run with no one in the chat', () => {
        expect(runsUnattended({ source: 'job', computer: 'studio-pc', jobId: 'j' })).toBe(true)
        expect(runsUnattended({ source: 'schedule', slug: 's', name: 'S' })).toBe(true)
        expect(runsUnattended({ source: 'chat', calledBy: 'agent-2' })).toBe(true)
        expect(runsUnattended({ source: 'chat' })).toBe(false)
    })
})
