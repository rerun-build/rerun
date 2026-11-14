import { useCallback, useEffect, useState } from 'react'

import { openDesktopAction } from '@/app/api/_actions/desktop.actions'

export type AgentScreen = { status: 'loading' } | { status: 'live'; socketUrl: string } | { status: 'error' } | { status: 'disconnected' }

export function useAgentScreen(agentId: string): { screen: AgentScreen; onDisconnect: () => void } {
    const [screen, setScreen] = useState<AgentScreen>({ status: 'loading' })

    useEffect(() => {
        let alive = true
        void openDesktopAction(agentId, 'watch', Intl.DateTimeFormat().resolvedOptions().timeZone).then(opened => {
            if (alive) setScreen(opened.ok ? { status: 'live', socketUrl: opened.socketUrl } : { status: 'error' })
        })
        return () => {
            alive = false
        }
    }, [agentId])

    const onDisconnect = useCallback(() => setScreen({ status: 'disconnected' }), [])

    return { screen, onDisconnect }
}
