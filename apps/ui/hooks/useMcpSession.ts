'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type McpSessionEntry = { state: string; errorClass?: string }

export type McpSession = {
    states: ReadonlyMap<string, McpSessionEntry>
    reconnecting: ReadonlySet<string>
    reconnect: (name: string) => Promise<{ ok: boolean }>
}

const POLL_MS = 5000

export function useMcpSession(agentId: string): McpSession {
    const [states, setStates] = useState<ReadonlyMap<string, McpSessionEntry>>(new Map())
    const [reconnecting, setReconnecting] = useState<ReadonlySet<string>>(new Set())
    const alive = useRef(true)

    const read = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents/${agentId}/mcp-session`)
            if (!res.ok) return
            const body = (await res.json()) as { servers: { name: string; state: string; errorClass?: string }[] }
            if (alive.current) setStates(new Map(body.servers.map(s => [s.name, { state: s.state, ...(s.errorClass ? { errorClass: s.errorClass } : {}) }])))
        } catch {}
    }, [agentId])

    useEffect(() => {
        alive.current = true
        void read()
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void read()
        }, POLL_MS)
        return () => {
            alive.current = false
            clearInterval(timer)
        }
    }, [read])

    const reconnect = useCallback(
        async (name: string): Promise<{ ok: boolean }> => {
            setReconnecting(prev => new Set(prev).add(name))
            const release = () =>
                setReconnecting(prev => {
                    const next = new Set(prev)
                    next.delete(name)
                    return next
                })
            try {
                const res = await fetch(`/api/agents/${agentId}/mcp-session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                })
                if (!res.ok) {
                    if (alive.current) release()
                    return { ok: false }
                }
                await read()
                if (alive.current) release()
                return { ok: true }
            } catch {
                if (alive.current) release()
                return { ok: false }
            }
        },
        [agentId, read],
    )

    return { states, reconnecting, reconnect }
}
