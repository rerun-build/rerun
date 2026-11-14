import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env.js'
import { desktopTokenMatches } from '../desktop/session.js'

const DESKTOP_APPS_PATH = /^\/agents\/([^/]+)\/desktop\/apps$/

function isDesktopPanelRequest(method: string, path: string, token: string): boolean {
    if (method !== 'POST') return false
    const segment = DESKTOP_APPS_PATH.exec(path)?.[1]
    if (segment === undefined) return false
    let agentId: string
    try {
        agentId = decodeURIComponent(segment)
    } catch {
        return false
    }
    return desktopTokenMatches(agentId, token)
}

export const auth: MiddlewareHandler = async (c, next) => {
    const key = env().RERUN_API_KEY
    if (!key) return next()
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : header
    if (token !== key && !isDesktopPanelRequest(c.req.method, c.req.path, token)) return c.json({ error: 'Unauthorized' }, 401)
    return next()
}
