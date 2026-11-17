import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import type { MiddlewareHandler } from 'hono'

// The foreman's identity, soul and tools are rewritten from code at every boot, so none of them is
// editable over HTTP: the hub may talk to it, read it, its conversations and its runs, stop a run or
// one of its delegated tasks, hand it the files of a chat message and pin the model it runs on. What
// it keeps for the team like a coworker keeps its own (memories, skills, its private database) is
// read and managed through the coworker routes.
const FOREMAN_OPEN_ROUTES: Array<{ method: string; path: RegExp }> = [
    { method: 'GET', path: /^\/agents\/foreman$/ },
    { method: 'POST', path: /^\/agents\/foreman\/chat$/ },
    { method: 'GET', path: /^\/agents\/foreman\/sessions$/ },
    { method: 'GET', path: /^\/agents\/foreman\/sessions\/[^/]+\/messages$/ },
    { method: 'GET', path: /^\/agents\/foreman\/runs\/[^/]+\/stream$/ },
    { method: 'POST', path: /^\/agents\/foreman\/runs\/[^/]+\/cancel$/ },
    { method: 'GET', path: /^\/agents\/foreman\/runs$/ },
    { method: 'GET', path: /^\/agents\/foreman\/runs\/[^/]+$/ },
    { method: 'GET', path: /^\/agents\/foreman\/runs\/[^/]+\/steps$/ },
    { method: 'POST', path: /^\/agents\/foreman\/runs\/[^/]+\/tasks\/[^/]+\/cancel$/ },
    { method: 'GET', path: /^\/agents\/foreman\/files\/raw$/ },
    { method: 'PUT', path: /^\/agents\/foreman\/files\/raw$/ },
    { method: 'POST', path: /^\/agents\/foreman\/files\/raw$/ },
    { method: 'GET', path: /^\/agents\/foreman\/files\/read$/ },
    { method: 'DELETE', path: /^\/agents\/foreman\/files$/ },
    // Where its apps stand: they come from the Vault, which the hub changes through `/vault`.
    { method: 'GET', path: /^\/agents\/foreman\/mcp-servers\/status$/ },
]

const FOREMAN_OPEN_SUBTREES = ['memories', 'skills', 'data'].map(resource => `/agents/${FOREMAN_AGENT_ID}/${resource}`)

const inOpenSubtree = (path: string) => FOREMAN_OPEN_SUBTREES.some(root => path === root || path.startsWith(`${root}/`))

// The only fields ensureForeman carries over a reboot, so the only ones worth accepting.
const FOREMAN_MODEL_FIELDS = new Set(['connectionId', 'provider', 'model'])

async function patchesOnlyTheModel(c: Parameters<MiddlewareHandler>[0]): Promise<boolean> {
    const body = (await c.req.json().catch(() => null)) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    return Object.keys(body).every(field => FOREMAN_MODEL_FIELDS.has(field))
}

export const foremanGuard: MiddlewareHandler = async (c, next) => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) return next()
    const path = c.req.path.replace(/\/$/, '')
    if (FOREMAN_OPEN_ROUTES.some(route => route.method === c.req.method && route.path.test(path)) || inOpenSubtree(path)) return next()
    if (c.req.method === 'PATCH' && path === `/agents/${FOREMAN_AGENT_ID}` && (await patchesOnlyTheModel(c))) return next()
    return c.json({ error: 'The foreman is managed by the engine and cannot be changed' }, 403)
}
