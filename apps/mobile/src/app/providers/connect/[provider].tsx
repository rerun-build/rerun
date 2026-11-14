import { addableProviderSchema } from '@rerun/contracts'
import { useLocalSearchParams } from 'expo-router'

import { useIsWorkspaceAdmin } from '@/auth/AuthProvider'
import { ApiKeyConnect, ChatGptConnect, ClaudeConnect } from '@/components/providers/connect'
import { ProvidersAdminOnly } from '@/components/providers/screens'

export default function ConnectProviderSheet() {
    const params = useLocalSearchParams<{ provider: string; reconnect?: string }>()
    const provider = addableProviderSchema.safeParse(params.provider)
    const workspaceAdmin = useIsWorkspaceAdmin()
    if (!workspaceAdmin) return <ProvidersAdminOnly />
    if (!provider.success) return null
    const reconnectId = params.reconnect ?? null
    if (provider.data === 'claude') return <ClaudeConnect reconnectId={reconnectId} />
    if (provider.data === 'codex') return <ChatGptConnect reconnectId={reconnectId} />
    return <ApiKeyConnect provider={provider.data} reconnectId={reconnectId} />
}
