import { FOREMAN_AGENT_ID, ROUTE_ID_PATTERN } from '@rerun/contracts'
import { Redirect, useLocalSearchParams } from 'expo-router'

import { CoworkerChat } from '@/components/chat/CoworkerChat'
import { ForemanChat } from '@/components/chat/ForemanChat'

const NEW = 'new'

// `id` is a conversation, `new`, `general` for a coworker's General, or `last` for the Foreman; `to`
// names the coworker, the Foreman when it is left out; `general` is the coworker's General when the
// opener knew it. They land in hub paths, so a link with anything else in them opens the home instead.
export default function Chat() {
    const { id, to, general } = useLocalSearchParams<{ id: string; to?: string; general?: string }>()
    if (!ROUTE_ID_PATTERN.test(id) || (to !== undefined && !ROUTE_ID_PATTERN.test(to)) || (general !== undefined && !ROUTE_ID_PATTERN.test(general))) return <Redirect href="/" />
    const sessionId = id === NEW ? null : id
    if (!to || to === FOREMAN_AGENT_ID) return <ForemanChat sessionId={sessionId} />
    return <CoworkerChat key={to} agentId={to} sessionId={sessionId} knownGeneralId={general ?? null} />
}
