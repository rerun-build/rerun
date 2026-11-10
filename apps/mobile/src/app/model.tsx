import { useLocalSearchParams } from 'expo-router'

import { AgentModelSheet } from '@/components/chat/AgentModelSheet'
import { SheetChrome } from '@/components/layout/SheetChrome'

export default function ModelSheet() {
    const { agent } = useLocalSearchParams<{ agent: string }>()
    return (
        <>
            <AgentModelSheet agentId={agent} />
            <SheetChrome />
        </>
    )
}
