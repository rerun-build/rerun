import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env.js'

const THIS_MACHINE_ONLY = new Set(['127.0.0.1', 'localhost', '::1'])

export function answersWithoutKeyBeyondThisMachine(host: string, key: string | undefined): boolean {
    return !key && !THIS_MACHINE_ONLY.has(host)
}

export const auth: MiddlewareHandler = async (c, next) => {
    const key = env().RERUN_API_KEY
    if (!key) return next()
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : header
    if (token !== key) return c.json({ error: 'Unauthorized' }, 401)
    return next()
}
