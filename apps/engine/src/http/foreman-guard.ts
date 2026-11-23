import { FOREMAN_AGENT_ID, agentKindPolicy, type ToolKey } from '@rerun/contracts'
import type { MiddlewareHandler } from 'hono'
import { FOREMAN_OWNED_FIELDS } from '../agents/foreman.js'

const policy = agentKindPolicy('foreman')

// The Chief of Staff answers every route a coworker answers, except what its kind does not do.
const FOREMAN_CLOSED_ROUTES: Array<{ method: string; path: RegExp; open: boolean }> = [
    { method: 'DELETE', path: /^\/agents\/foreman$/, open: policy.deletable },
    { method: 'POST', path: /^\/agents\/foreman\/duplicate$/, open: policy.duplicable },
    { method: 'GET', path: /^\/agents\/foreman\/archive(\/plan)?$/, open: policy.exportable },
    { method: 'POST', path: /^\/agents\/foreman\/automations\/activate$/, open: policy.installable },
]

// The soul and the install prompt are files, not fields of the config, but a PATCH carries them too.
const FOREMAN_OWNED_BODY_FIELDS = new Set<string>([...FOREMAN_OWNED_FIELDS, 'soul', 'install'])

function switchesOffALockedTool(tools: unknown): boolean {
    if (tools === undefined) return false
    if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return true
    return Object.entries(tools).some(([key, on]) => on !== true && policy.lockedTools.includes(key as ToolKey))
}

async function patchesWhatItOwns(c: Parameters<MiddlewareHandler>[0]): Promise<boolean> {
    const body = (await c.req.json().catch(() => null)) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return true
    const fields = body as Record<string, unknown>
    return Object.keys(fields).some(field => FOREMAN_OWNED_BODY_FIELDS.has(field)) || switchesOffALockedTool(fields.tools)
}

export const foremanGuard: MiddlewareHandler = async (c, next) => {
    if (c.req.param('id') !== FOREMAN_AGENT_ID) return next()
    const path = c.req.path.replace(/\/$/, '')
    const closed = FOREMAN_CLOSED_ROUTES.some(route => !route.open && route.method === c.req.method && route.path.test(path))
    if (!closed && !(c.req.method === 'PATCH' && path === `/agents/${FOREMAN_AGENT_ID}` && (await patchesWhatItOwns(c)))) return next()
    return c.json({ error: 'The foreman is managed by the engine and cannot be changed' }, 403)
}
