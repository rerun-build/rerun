import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import type { MiddlewareHandler } from 'hono'

// The foreman's configuration is rewritten from code at every boot, so who it is cannot be changed
// over HTTP: no rename, no soul, no tool switch, no deletion, no copy. The hub may talk to it, read
// it, its conversations and its runs, stop a run or one of its delegated tasks, pin the model it
// runs on, and manage what it keeps of its own like any coworker: its files, memories, skills,
// routines and the servers connected to it.
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
    { method: 'GET', path: /^\/agents\/foreman\/files$/ },
    { method: 'PUT', path: /^\/agents\/foreman\/files$/ },
    { method: 'POST', path: /^\/agents\/foreman\/files\/(move|dir)$/ },
    { method: 'PATCH', path: /^\/agents\/foreman\/mcp-servers$/ },
    { method: 'GET', path: /^\/agents\/foreman\/mcp-servers\/status$/ },
    { method: 'PUT', path: /^\/agents\/foreman\/mcp\/[^/]+\/token$/ },
    { method: 'DELETE', path: /^\/agents\/foreman\/mcp\/[^/]+\/token$/ },
    { method: 'GET', path: /^\/agents\/foreman\/keys$/ },
    { method: 'PATCH', path: /^\/agents\/foreman\/keys$/ },
]

// Whole routers, every method: each one only reads and writes files beside the configuration.
const FOREMAN_OPEN_FAMILIES = /^\/agents\/foreman\/(memories|skills|skill-proposals|schedules)(\/.*)?$/

// The model is the one field of its configuration a person sets through this route.
const FOREMAN_MODEL_FIELDS = new Set(['connectionId', 'provider', 'model'])

async function patchesOnlyTheModel(c: Parameters<MiddlewareHandler>[0]): Promise<boolean> {
    const body = (await c.req.json().catch(() => null)) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    return Object.keys(body).every(field => FOREMAN_MODEL_FIELDS.has(field))
}

export const foremanGuard: MiddlewareHandler = async (c, next) => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) return next()
    const path = c.req.path.replace(/\/$/, '')
    if (FOREMAN_OPEN_FAMILIES.test(path) || FOREMAN_OPEN_ROUTES.some(route => route.method === c.req.method && route.path.test(path))) return next()
    if (c.req.method === 'PATCH' && path === `/agents/${FOREMAN_AGENT_ID}` && (await patchesOnlyTheModel(c))) return next()
    return c.json({ error: 'The foreman is managed by the engine and cannot be changed' }, 403)
}
