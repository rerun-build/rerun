import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const FAKE_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-fake-codex-'))
const FAKE_CODEX = resolve(FAKE_DIR, 'codex.mjs')
const MODEL_LIST = resolve(FAKE_DIR, 'model-list.json')
process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-codex-session-'))
process.env.RERUN_CODEX_PATH = FAKE_CODEX

writeFileSync(
    FAKE_CODEX,
    `import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
createInterface({ input: process.stdin }).on('line', line => {
    const { id, method } = JSON.parse(line)
    if (method === 'initialize') send({ id, result: { userAgent: 'rerun-engine/0.166.0 (Ubuntu 24.4.0; x86_64) unknown (rerun-engine; 1)' } })
    if (method === 'account/rateLimits/read') send({ id, result: { rateLimits: { primary: { usedPercent: 12, resetsAt: null } } } })
    if (method === 'model/list') {
        const answer = JSON.parse(readFileSync(${JSON.stringify(MODEL_LIST)}, 'utf8'))
        if (!answer.silent) send({ id, ...answer })
    }
})
`
)

const { readCodexSession } = await import('./codex-plan-limits.js')
const { codexHomeDir } = await import('../config/paths.js')

const answerModelList = (answer: unknown): void => writeFileSync(MODEL_LIST, JSON.stringify(answer))

beforeEach(() => {
    mkdirSync(codexHomeDir('codex-1'), { recursive: true })
})

describe('readCodexSession', () => {
    it('reads the plan limits, the version and the models the account is offered in one session', async () => {
        answerModelList({ result: { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }, { id: 'codex-auto-review', hidden: true }], nextCursor: null } })
        const session = await readCodexSession('codex-1')
        expect(session).toMatchObject({ version: '0.166.0', models: ['gpt-6-luna', 'gpt-6.1-sol'] })
        expect(session?.rateLimits).toMatchObject({ rateLimits: { primary: { usedPercent: 12 } } })
    })

    it('reads no models from a list it only got the first page of', async () => {
        answerModelList({ result: { data: [{ id: 'gpt-6-luna' }], nextCursor: 'page-2' } })
        expect((await readCodexSession('codex-1'))?.models).toEqual([])
    })

    it('keeps the plan limits it got when the model list never comes back', async () => {
        answerModelList({ silent: true })
        const session = await readCodexSession('codex-1', 500)
        expect(session?.rateLimits).toMatchObject({ rateLimits: { primary: { usedPercent: 12 } } })
        expect(session).toMatchObject({ version: '0.166.0', models: [] })
    })

    it('reads no models when the binary refuses the request', async () => {
        answerModelList({ error: { code: -32601, message: 'method not found' } })
        const session = await readCodexSession('codex-1')
        expect(session?.models).toEqual([])
        expect(session?.version).toBe('0.166.0')
    })
})
