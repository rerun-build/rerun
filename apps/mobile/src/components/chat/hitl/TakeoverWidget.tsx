import { ChatScreen } from '@/components/chat/screen/ChatScreen'
import { useAgentScreen } from '@/components/chat/screen/useAgentScreen'
import { useTakeoverRequest } from '@/components/chat/screen/useTakeoverRequest'

import type { HitlWidgetProps } from './registry'

export function TakeoverWidget({ pending, agentId, coworkerName, onAnswer }: HitlWidgetProps) {
    const takeover = useTakeoverRequest(agentId, coworkerName, pending, onAnswer)
    const screen = useAgentScreen(agentId, true)
    return <ChatScreen status={screen.status} uri={screen.uri} onMessage={screen.onMessage} attachWebView={screen.attachWebView} site={takeover?.site ?? null} takeover={takeover} onTakeControl={() => takeover?.onOpen()} />
}
