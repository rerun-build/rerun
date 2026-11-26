import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-retry-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

vi.mock('./notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('./notify.js')>()), sendNotification: async () => ({ delivered: true }) }))
// A sign-in that cannot be renewed fails the turn before its message is stored. It rejects a moment
// later, as a refresh over the network does, once the run is already waiting on it.
const cliAuth = vi.hoisted(() => ({ fails: false }))
vi.mock('../connections/cli-auth.js', () => ({
    ensureCliAuth: () => (cliAuth.fails ? new Promise((_, reject) => setTimeout(() => reject(new Error('sign-in expired')), 50)) : Promise.resolve(() => {})),
}))
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
// The engine replays a step that failed before saying anything, after 2 s then 8 s: the same replays, without the wait.
vi.mock('../agents/openrouter-stream-retry.js', async importOriginal => {
    const original = await importOriginal<typeof import('../agents/openrouter-stream-retry.js')>()
    return { ...original, openrouterStreamRetryMiddleware: original.createStreamRetryMiddleware([0, 0]) }
})

const { afterAll, afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { getSystemDb } = await import('../db/systemDb.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { listMessages } = await import('../db/repos/messages.js')
const { createConnection } = await import('../connections/store.js')
const { runAgent } = await import('./loop.js')

const id = 'retryagent'
const FAIL = 'fail'
const FAILED_RUN = [FAIL, FAIL, FAIL]
const LM_STUDIO_CONTEXT_ERROR = 'The number of tokens to keep from the initial prompt is greater than the context length. Try to load the model with a larger context length, or provide a shorter input'
const answers: string[] = []
const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []

const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const delta = (choice: Record<string, unknown>) => event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: null, ...choice }] })
const usage = event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 9, completion_tokens: 9, total_tokens: 18 } })
const says = (content: string) => [delta({ delta: { role: 'assistant', content } }), delta({ finish_reason: 'stop' }), usage, 'data: [DONE]\n\n']
// LM Studio streams its refusal: a 200 whose only event is the error, the text the chat shows.
const refuses = [event({ error: { message: LM_STUDIO_CONTEXT_ERROR } }), 'data: [DONE]\n\n']

const textOf = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? ((content[0] as { text?: string } | undefined)?.text ?? '') : '')
const userTurnsSent = (request: (typeof requests)[number]) => request.messages.filter(m => m.role === 'user').map(m => textOf(m.content))
const storedTurns = async (sessionId: string) => (await listMessages(id, sessionId)).map(row => ({ role: row.role, text: textOf(JSON.parse(row.contentJson)), authorId: row.authorId }))

describe('Retry after a turn the provider refused', () => {
    let server: Server

    beforeAll(async () => {
        await migrate()
        server = createServer((req, res) => {
            const chunks: Buffer[] = []
            req.on('data', c => chunks.push(c)).on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString())
                if (!body.stream) {
                    res.writeHead(200, { 'content-type': 'application/json' })
                    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Title' }, finish_reason: 'stop' }] }))
                    return
                }
                requests.push(body)
                const answer = answers.shift() ?? 'nothing left to say'
                res.writeHead(200, { 'content-type': 'text/event-stream' })
                for (const line of answer === FAIL ? refuses : says(answer)) res.write(line)
                res.end()
            })
        })
        await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready))
        const { port } = server.address() as { port: number }
        const connectionId = (await createConnection({ name: 'LM Studio', provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, keys: {}, models: ['m'], extraModels: ['m'] })).id
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'local', connectionId, provider: 'custom', model: 'm', selfImprovement: { enabled: false } }))
    })

    afterAll(() => void server.close())

    afterEach(() => {
        answers.length = 0
        requests.length = 0
        cliAuth.fails = false
    })

    async function send(sessionId: string, text: string, author?: { id: string; name: string }) {
        const run = await runAgent(await getAgent(id), sessionId, text, undefined, undefined, undefined, { source: 'chat', author })
        return run.settled
    }

    it('sends and stores the message once, however many times it is retried', async () => {
        const session = await createSession(id, 'hello')
        answers.push(...FAILED_RUN, ...FAILED_RUN, ...FAILED_RUN)

        for (let attempt = 0; attempt < 3; attempt++) expect((await send(session.id, 'hello')).kind).toBe('error')

        expect(requests.map(userTurnsSent)).toEqual(Array(9).fill(['hello']))
        expect(await storedTurns(session.id)).toEqual([{ role: 'user', text: 'hello', authorId: null }])
    }, 30_000)

    it('keeps the message when the retry fails before it is stored', async () => {
        const session = await createSession(id, 'hello')
        answers.push(...FAILED_RUN, 'Hi!')

        await send(session.id, 'hello')
        cliAuth.fails = true
        await expect(send(session.id, 'hello')).rejects.toThrow('sign-in expired')
        expect(await storedTurns(session.id)).toEqual([{ role: 'user', text: 'hello', authorId: null }])

        cliAuth.fails = false
        expect((await send(session.id, 'hello')).kind).toBe('done')
        expect(userTurnsSent(requests.at(-1)!)).toEqual(['hello'])
        expect((await storedTurns(session.id)).map(turn => turn.role)).toEqual(['user', 'assistant'])
    }, 30_000)

    it('keeps the failed message when the next one says something else', async () => {
        const session = await createSession(id, 'hello')
        answers.push(...FAILED_RUN, 'Hi!')

        await send(session.id, 'hello')
        expect((await send(session.id, 'are you there?')).kind).toBe('done')

        expect(requests.at(-1) && userTurnsSent(requests.at(-1)!)).toEqual(['hello', 'are you there?'])
        expect((await storedTurns(session.id)).map(turn => turn.text)).toEqual(['hello', 'are you there?', 'Hi!'])
    }, 30_000)

    it('keeps a message that was answered when the same text comes again', async () => {
        const session = await createSession(id, 'hello')
        answers.push('Hi!', 'Hi again!')

        await send(session.id, 'hello')
        await send(session.id, 'hello')

        expect(userTurnsSent(requests.at(-1)!)).toEqual(['hello', 'hello'])
        expect((await storedTurns(session.id)).map(turn => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    }, 30_000)

    it('keeps the same text sent by someone else in a shared conversation', async () => {
        const session = await createSession(id, 'hello')
        answers.push(...FAILED_RUN, 'Hi both!')

        await send(session.id, 'hello', { id: 'user-a', name: 'Ada' })
        await send(session.id, 'hello', { id: 'user-b', name: 'Bob' })

        expect((await storedTurns(session.id)).filter(turn => turn.role === 'user').map(turn => turn.authorId)).toEqual(['user-a', 'user-b'])
    }, 30_000)

    it('answers the retry with one copy of the message and leaves nothing of the dropped one in the search index', async () => {
        const session = await createSession(id, 'find the mango invoice')
        answers.push(...FAILED_RUN, 'Found it.')

        await send(session.id, 'find the mango invoice')
        expect((await send(session.id, 'find the mango invoice')).kind).toBe('done')

        const stored = await listMessages(id, session.id)
        expect(stored.map(row => row.role)).toEqual(['user', 'assistant'])
        expect(userTurnsSent(requests.at(-1)!)).toEqual(['find the mango invoice'])
        const { client } = await getSystemDb(id)
        const indexed = await client.execute({ sql: "SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'mango'", args: [] })
        expect(indexed.rows.map(row => row.message_id)).toEqual([stored[0].id])
    }, 30_000)
})
