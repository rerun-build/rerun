import { createHmac } from 'crypto'

import { DESKTOP_TICKET_TTL_MS, type DesktopViewMode } from '@rerun/contracts'

export function mintDesktopTicket(engineApiKey: string, engineAgentId: string, mode: DesktopViewMode, now: number = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ exp: now + DESKTOP_TICKET_TTL_MS, agent: engineAgentId, mode })).toString('base64url')
    return `${payload}.${createHmac('sha256', engineApiKey).update(payload).digest('base64url')}`
}
