import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-stream-error-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { clicks, answers, requests } = vi.hoisted(() => ({ clicks: [] as unknown[], answers: [] as string[][], requests: { count: 0 } }))

vi.mock('./notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('./notify.js')>()), sendNotification: async () => ({ delivered: true }) }))
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
vi.mock('../desktop/session.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../desktop/session.js')>()),
    computerAvailable: () => true,
    humanDriving: () => false,
    holdDesktop: () => () => {},
}))
vi.mock('../desktop/takeover.js', async importOriginal => ({ ...(await importOriginal<typeof import('../desktop/takeover.js')>()), holdOpenBrowser: () => () => {} }))
vi.mock('../desktop/control.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../desktop/control.js')>()),
    controlScreen: async (agentId: string) => ({ agentId }),
    captureScreen: async () => ({ image: Buffer.from('shot'), mediaType: 'image/jpeg', width: 1280, height: 720, view: Buffer.alloc(400) }),
    click: async (_control: unknown, at: unknown) => void clicks.push(at),
}))

const { afterAll, afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun } = await import('../db/repos/runs.js')
const { createConnection } = await import('../connections/store.js')
const { agentsOnScreen } = await import('../tools/builtin/computer.js')
const { runAgent } = await import('./loop.js')

const id = 'streamerroragent'
const PAUSE = 'pause'
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const delta = (choice: Record<string, unknown>) => event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: null, ...choice }] })
const usage = event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 9, completion_tokens: 9, total_tokens: 18 } })
const end = (reason: string) => [delta({ finish_reason: reason }), usage, 'data: [DONE]\n\n']

const says = (content: string) => [delta({ delta: { role: 'assistant', content } }), ...end('stop')]
const callsComputer = (args: Record<string, unknown>) => [delta({ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${Math.random()}`, type: 'function', function: { name: 'computer', arguments: JSON.stringify(args) } }] } }), ...end('tool_calls')]
const failure = event({ error: { message: 'Streaming response failed: [500] Internal server error', type: 'server_error' } })
const failsWhileReasoning = [delta({ delta: { role: 'assistant', reasoning_content: 'Let me look' } }), failure, 'data: [DONE]\n\n']

const screenshot = callsComputer({ action: 'screenshot' })
const clickAt = (x: number) => callsComputer({ action: 'left_click', coordinate: [x, x] })

describe('a provider that fails in the middle of its stream', () => {
    let server: Server
    let connectionId: string

    beforeAll(async () => {
        await migrate()
        server = createServer((req, res) => {
            req.resume().on('end', async () => {
                requests.count += 1
                res.writeHead(200, { 'content-type': 'text/event-stream' })
                for (const line of answers.shift() ?? says('nothing left to say')) {
                    if (line === PAUSE) await new Promise(r => setTimeout(r, 200))
                    else res.write(line)
                }
                res.end()
            })
        })
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready))
        const { port } = server.address() as { port: number }
        connectionId = (await createConnection({ name: 'Flaky', provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, keys: {}, models: ['m'], extraModels: ['m'], vision: true })).id
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'flaky', connectionId, provider: 'custom', model: 'm', selfImprovement: { enabled: false } }))
    })

    afterAll(() => void server.close())

    afterEach(() => {
        clicks.length = 0
        answers.length = 0
        requests.count = 0
    })

    async function send(message: string) {
        const session = await createSession(id, message)
        const run = await runAgent(await getAgent(id), session.id, message)
        const outcome = await run.settled
        return { outcome, status: (await getRun(id, run.runId))?.status }
    }

    it('goes on with the replayed step, and gives the screen back at the end', async () => {
        answers.push(screenshot, failsWhileReasoning, clickAt(1), says('Clicked.'))

        const { outcome, status } = await send('click')

        expect(outcome).toEqual({ kind: 'done' })
        expect(status).toBe('done')
        expect(clicks).toEqual([[1, 1]])
        expect(agentsOnScreen()).toEqual([])
    }, 15_000)

    it('does nothing more once the run failed, and leaves the screen to the next one', async () => {
        const failsWithATool = [delta({ delta: { role: 'assistant', content: 'On it.' } }), failure, PAUSE, ...clickAt(2)]
        answers.push(screenshot, failsWithATool, clickAt(3), says('Still here.'))

        const { outcome, status } = await send('click')
        await new Promise(r => setTimeout(r, 1_500))

        expect(outcome).toMatchObject({ kind: 'error', error: 'Streaming response failed: [500] Internal server error' })
        expect(status).toBe('error')
        expect(requests.count).toBe(2)
        expect(clicks).toEqual([])
        expect(agentsOnScreen()).toEqual([])

        answers.length = 0
        answers.push(clickAt(4), says('Clicked.'))
        expect((await send('again')).outcome).toEqual({ kind: 'done' })
        expect(clicks).toEqual([[4, 4]])
    }, 15_000)
})
