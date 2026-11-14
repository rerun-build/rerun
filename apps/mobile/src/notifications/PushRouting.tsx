import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'

import { pushDataOf } from './push'

export function PushRouting() {
    const response = Notifications.useLastNotificationResponse()
    const handled = useRef<string | null>(null)
    useEffect(() => {
        if (!response) return
        const identifier = response.notification.request.identifier
        if (handled.current === identifier) return
        handled.current = identifier
        const data = pushDataOf(response.notification)
        if (!data?.agentId) return
        if (data.agentId === FOREMAN_AGENT_ID) router.push({ pathname: '/chat/[id]', params: { id: data.conversationId ?? 'last' } })
        else router.push({ pathname: '/chat/[id]', params: { id: data.conversationId ?? 'new', to: data.agentId } })
    }, [response])
    return null
}
