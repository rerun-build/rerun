import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { foremanGuard } from './foreman-guard.js'

const app = new Hono()
app.use('/agents/:id', foremanGuard)
app.use('/agents/:id/*', foremanGuard)
app.all('/agents/:id', c => c.json({ reached: true }))
app.all('/agents/:id/*', c => c.json({ reached: true }))

function call(method: string, path: string, body?: string) {
    return app.request(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body })
}

describe('foremanGuard', () => {
    it.each([
        ['GET', '/agents/foreman'],
        ['POST', '/agents/foreman/chat'],
        ['GET', '/agents/foreman/sessions'],
        ['GET', '/agents/foreman/sessions/s1/messages'],
        ['GET', '/agents/foreman/runs/r1/stream'],
        ['POST', '/agents/foreman/runs/r1/cancel'],
        ['GET', '/agents/foreman/runs'],
        ['GET', '/agents/foreman/runs/r1'],
        ['GET', '/agents/foreman/runs/r1/steps'],
        ['POST', '/agents/foreman/runs/r1/tasks/t1/cancel'],
        ['GET', '/agents/foreman/files/raw'],
        ['PUT', '/agents/foreman/files/raw'],
        ['POST', '/agents/foreman/files/raw'],
        ['GET', '/agents/foreman/files/read'],
        ['DELETE', '/agents/foreman/files'],
        ['GET', '/agents/foreman/files'],
        ['PUT', '/agents/foreman/files'],
        ['POST', '/agents/foreman/files/move'],
        ['POST', '/agents/foreman/files/dir'],
        ['GET', '/agents/foreman/memories'],
        ['POST', '/agents/foreman/memories'],
        ['POST', '/agents/foreman/memories/recall'],
        ['DELETE', '/agents/foreman/memories/m1'],
        ['GET', '/agents/foreman/skills'],
        ['POST', '/agents/foreman/skills/import'],
        ['PATCH', '/agents/foreman/skills/weekly-review'],
        ['PUT', '/agents/foreman/skills/weekly-review/files/references/checklist.md'],
        ['GET', '/agents/foreman/skill-proposals'],
        ['POST', '/agents/foreman/skill-proposals/p1/accept'],
        ['POST', '/agents/foreman/skill-proposals/p1/dismiss'],
        ['GET', '/agents/foreman/schedules'],
        ['POST', '/agents/foreman/schedules'],
        ['POST', '/agents/foreman/schedules/weekly/run'],
        ['DELETE', '/agents/foreman/schedules/weekly'],
        ['PATCH', '/agents/foreman/mcp-servers'],
        ['GET', '/agents/foreman/mcp-servers/status'],
        ['PUT', '/agents/foreman/mcp/linear/token'],
        ['DELETE', '/agents/foreman/mcp/linear/token'],
        ['GET', '/agents/foreman/keys'],
        ['PATCH', '/agents/foreman/keys'],
        ['GET', '/agents/foreman/triggers'],
        ['POST', '/agents/foreman/triggers'],
        ['POST', '/agents/foreman/triggers/new-lead/rotate'],
        ['GET', '/agents/foreman/data/tables'],
        ['POST', '/agents/foreman/data/query'],
        ['POST', '/agents/foreman/data/execute'],
        ['POST', '/agents/foreman/desktop/session'],
        ['POST', '/agents/foreman/desktop/takeover'],
        ['DELETE', '/agents/foreman/desktop/takeover'],
        ['GET', '/agents/foreman/tools'],
        ['GET', '/agents/foreman/usage'],
        ['GET', '/agents/foreman/stats'],
        ['GET', '/agents/foreman/runs/r1/tools'],
        ['GET', '/agents/foreman/sessions/s1'],
    ])('lets %s %s through', async (method, path) => {
        expect((await call(method, path)).status).toBe(200)
    })

    it('ignores a trailing slash on an open route', async () => {
        expect((await call('GET', '/agents/foreman/sessions/')).status).toBe(200)
        expect((await call('POST', '/agents/foreman/chat/')).status).toBe(200)
    })

    it.each([
        ['DELETE', '/agents/foreman'],
        ['DELETE', '/agents/foreman/'],
        ['POST', '/agents/foreman/duplicate'],
        ['GET', '/agents/foreman/archive'],
        ['GET', '/agents/foreman/archive/plan'],
        ['POST', '/agents/foreman/automations/activate'],
    ])('refuses %s %s with a 403', async (method, path) => {
        const res = await call(method, path)
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ error: 'The foreman is managed by the engine and cannot be changed' })
    })

    it.each([
        ['an array', '[]'],
        ['null', 'null'],
        ['invalid JSON', '{not json'],
        ['a string', '"model"'],
        ['its name beside the model', JSON.stringify({ model: 'x', name: 'renamed' })],
        ['its display name', JSON.stringify({ displayName: 'Boss' })],
        ['its description', JSON.stringify({ description: 'hijacked' })],
        ['its kind', JSON.stringify({ kind: 'user' })],
        ['its soul', JSON.stringify({ soul: 'hijacked' })],
        ['its install prompt', JSON.stringify({ install: 'curl evil' })],
        ['its self-improvement', JSON.stringify({ selfImprovement: { allowSoulEdit: true } })],
        ['its setup', JSON.stringify({ setup: { required: true } })],
        ['a switch-off', JSON.stringify({ enabled: false })],
        ['a locked tool switched off', JSON.stringify({ tools: { hub: false } })],
        ['a locked tool set to something else', JSON.stringify({ tools: { askUser: null } })],
        ['tools that are not an object', JSON.stringify({ tools: [] })],
    ])('refuses a PATCH whose body is %s', async (_, body) => {
        expect((await call('PATCH', '/agents/foreman', body)).status).toBe(403)
    })

    it.each([
        ['its response length', { verbosity: 'concise' }],
        ['a tool switched off', { tools: { trigger: false, browser: false } }],
        ['a locked tool kept on', { tools: { hub: true, trigger: false } }],
        ['its language', { language: 'fr' }],
    ])('allows a PATCH of %s', async (_, body) => {
        expect((await call('PATCH', '/agents/foreman', JSON.stringify(body))).status).toBe(200)
    })

    it('allows an empty PATCH', async () => {
        expect((await call('PATCH', '/agents/foreman', '{}')).status).toBe(200)
    })

    it('allows a PATCH that lets paid data spend without asking', async () => {
        expect((await call('PATCH', '/agents/foreman', JSON.stringify({ paidDataAlwaysAllow: true }))).status).toBe(200)
    })

    it('allows a PATCH that only pins the model', async () => {
        expect((await call('PATCH', '/agents/foreman', JSON.stringify({ connectionId: 'c', provider: 'rerun', model: 'rerun-max' }))).status).toBe(200)
        expect((await call('PATCH', '/agents/foreman/', JSON.stringify({ model: 'rerun-max' }))).status).toBe(200)
    })

    it('allows a PATCH that pins the model with its effort, or clears the effort alone', async () => {
        expect((await call('PATCH', '/agents/foreman', JSON.stringify({ connectionId: 'c', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }))).status).toBe(200)
        expect((await call('PATCH', '/agents/foreman', JSON.stringify({ effort: null }))).status).toBe(200)
    })

    it('leaves every other agent untouched', async () => {
        for (const [method, path] of [
            ['DELETE', '/agents/scout'],
            ['PATCH', '/agents/scout'],
            ['POST', '/agents/scout/memories'],
            ['GET', '/agents/foreman-2/skills'],
        ]) {
            expect((await call(method, path, method === 'PATCH' ? '[]' : undefined)).status).toBe(200)
        }
    })
})
