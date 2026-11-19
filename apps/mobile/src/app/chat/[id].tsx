import { FOREMAN_AGENT_ID, ROUTE_ID_PATTERN } from '@moldwright/contracts'
import { Redirect, useLocalSearchParams } from 'expo-router'

import { CoworkerChat } from '@/components/chat/CoworkerChat'
import { ForemanChat } from '@/components/chat/ForemanChat'

const NEW = 'new'

export default function Chat() {
    const { id, to } = useLocalSearchParams<{ id: string; to?: string }>()
    if (!ROUTE_ID_PATTERN.test(id) || (to !== undefined && !ROUTE_ID_PATTERN.test(to))) return <Redirect href="/" />
    const sessionId = id === NEW ? null : id
    if (!to || to === FOREMAN_AGENT_ID) return <ForemanChat sessionId={sessionId} />
    return <CoworkerChat agentId={to} sessionId={sessionId} />
}
