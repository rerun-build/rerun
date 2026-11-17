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
        ['GET', '/agents/foreman/mcp-servers/status'],
    ])('lets %s %s through', async (method, path) => {
        expect((await call(method, path)).status).toBe(200)
    })

    it('ignores a trailing slash on an open route', async () => {
        expect((await call('GET', '/agents/foreman/sessions/')).status).toBe(200)
        expect((await call('POST', '/agents/foreman/chat/')).status).toBe(200)
    })

    it.each([
        ['GET', '/agents/foreman/memories'],
        ['POST', '/agents/foreman/memories'],
        ['POST', '/agents/foreman/memories/recall'],
        ['DELETE', '/agents/foreman/memories/m1'],
        ['GET', '/agents/foreman/skills'],
        ['POST', '/agents/foreman/skills'],
        ['PATCH', '/agents/foreman/skills/onboarding'],
        ['DELETE', '/agents/foreman/skills/onboarding'],
        ['PUT', '/agents/foreman/skills/onboarding/files/raw'],
        ['GET', '/agents/foreman/data/tables'],
        ['POST', '/agents/foreman/data/query'],
        ['DELETE', '/agents/foreman/data/tables/leads'],
    ])('lets what it keeps for the team through: %s %s', async (method, path) => {
        expect((await call(method, path)).status).toBe(200)
    })

    it.each([
        ['GET', '/agents/foreman/memoriesx'],
        ['GET', '/agents/foreman/skill-proposals'],
        ['GET', '/agents/foreman/datasets'],
        ['PATCH', '/agents/foreman/mcp-servers'],
        ['PUT', '/agents/foreman/mcp/notion/token'],
        ['PATCH', '/agents/foreman/keys'],
        ['GET', '/agents/foreman/triggers'],
        ['POST', '/agents/foreman/schedules'],
        ['DELETE', '/agents/foreman'],
        ['GET', '/agents/foreman/keys'],
        ['POST', '/agents/foreman/sessions'],
        ['GET', '/agents/foreman/chat'],
        ['GET', '/agents/foreman/sessions/s1/messages/extra'],
        ['GET', '/agents/foreman/runs/r1/tools'],
        ['GET', '/agents/foreman/files'],
        ['PUT', '/agents/foreman/files'],
        ['POST', '/agents/foreman/files/move'],
        ['POST', '/agents/foreman/files/dir'],
        ['GET', '/agents/foreman/usage'],
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
        ['a field beyond the model', JSON.stringify({ model: 'x', name: 'renamed' })],
    ])('refuses a PATCH whose body is %s', async (_, body) => {
        expect((await call('PATCH', '/agents/foreman', body)).status).toBe(403)
    })

    it('allows an empty PATCH', async () => {
        expect((await call('PATCH', '/agents/foreman', '{}')).status).toBe(200)
    })

    it('allows a PATCH that only pins the model', async () => {
        expect((await call('PATCH', '/agents/foreman', JSON.stringify({ connectionId: 'c', provider: 'rerun', model: 'rerun-max' }))).status).toBe(200)
        expect((await call('PATCH', '/agents/foreman/', JSON.stringify({ model: 'rerun-max' }))).status).toBe(200)
    })

    it('refuses a model-only PATCH aimed at a sub-route', async () => {
        expect((await call('PATCH', '/agents/foreman/keys', JSON.stringify({ model: 'x' }))).status).toBe(403)
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
