import type { AddableProvider, AiConnectionsView } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AI_PROVIDERS_ADMIN_ONLY, type AccessReason } from '@/auth/access'
import { ErrorCard } from '@/components/chat/ErrorCard'
import { AddProvider } from '@/components/providers/AddProvider'
import { ApiKeyForm } from '@/components/providers/ApiKeyForm'
import { describeUsage, SheetFrame } from '@/components/providers/bits'
import { ConnectionDetail } from '@/components/providers/ConnectionDetail'
import { DefaultModelPicker } from '@/components/providers/DefaultModelPicker'
import { ChatGptSignIn, ClaudeSignIn, type ChatGptPhase, type ClaudePhase, type SignInEnding } from '@/components/providers/PlanSignIn'
import { ProvidersList } from '@/components/providers/ProvidersList'
import { ProvidersAdminOnly } from '@/components/providers/screens'
import { AppText } from '@/components/ui/AppText'
import { AI_CONNECTIONS_CREDIT_USED_UP, AI_CONNECTIONS_FULL, AI_CONNECTIONS_KEYS, AI_CONNECTIONS_RECONNECT, AI_CONNECTIONS_RERUN_ONLY, AI_CONNECTIONS_TRIAL, MOCK_USAGE } from '@/mocks/aiConnections'
import { spacing } from '@/theme/tokens'

// Dev only: every AI providers screen in each of its states, on mock data, in the form sheet they
// open in. `rerun://lab-providers?screen=list&state=full`, `&role=member` for the read-only copy.

const VIEWS: Record<string, AiConnectionsView> = { 'rerun-only': AI_CONNECTIONS_RERUN_ONLY, full: AI_CONNECTIONS_FULL, keys: AI_CONNECTIONS_KEYS, reconnect: AI_CONNECTIONS_RECONNECT, credit: AI_CONNECTIONS_CREDIT_USED_UP, trial: AI_CONNECTIONS_TRIAL }

const noop = () => {}
const back = () => router.back()

function useEnding(kind: string | undefined, placeholder: string): SignInEnding {
    const [name, setName] = useState(placeholder)
    if (kind === 'reconnect') return { kind: 'reconnect' }
    return { kind: 'name', name, placeholder, onName: setName, onDone: back, saving: false, error: null }
}

function ClaudeLab({ state, ending }: { state?: string; ending?: string }) {
    const [code, setCode] = useState(state === 'waiting' || state === 'error' || state === 'checking' ? 'abc123#9f2e' : '')
    const phase: ClaudePhase = state === 'error' ? 'waiting' : ((state as ClaudePhase | undefined) ?? 'idle')
    const error = state === 'error' ? 'Oops, this code comes from another Claude tab. Close your Claude tabs, click Open Claude again and paste the new code.' : null
    return <ClaudeSignIn phase={phase} error={error} code={code} onCode={setCode} onOpenClaude={noop} onPaste={noop} onSubmit={noop} ending={useEnding(ending, 'Claude 2')} onBack={back} />
}

function ChatGptLab({ state, ending }: { state?: string; ending?: string }) {
    const phase: ChatGptPhase = state === 'stuck' || state === 'code' ? 'waiting' : state === 'expired' ? 'idle' : ((state as ChatGptPhase | undefined) ?? 'idle')
    const pending = state === 'code' || state === 'stuck' ? { userCode: 'K7QM-4XPD', verificationUrl: 'https://auth.openai.com/codex/device' } : null
    return <ChatGptSignIn phase={phase} pending={pending} expired={state === 'expired'} stuck={state === 'stuck' || state === 'expired'} error={null} onGetCode={noop} ending={useEnding(ending, 'ChatGPT 2')} onBack={back} />
}

function KeyLab({ provider, state }: { provider?: string; state?: string }) {
    const entry = AI_CONNECTIONS_FULL.addable.find(candidate => candidate.provider === provider) ?? AI_CONNECTIONS_FULL.addable[2]
    const [name, setName] = useState(entry.suggestedName)
    const [apiKey, setApiKey] = useState(state === 'error' || state === 'busy' ? 'sk-or-v1-0000' : '')
    const [baseUrl, setBaseUrl] = useState('')
    return <ApiKeyForm entry={entry} name={name} onName={setName} apiKey={apiKey} onApiKey={setApiKey} baseUrl={baseUrl} onBaseUrl={setBaseUrl} busy={state === 'busy'} error={state === 'error' ? `${entry.title} turned this key down.` : null} onConnect={noop} onBack={back} />
}

function DetailLab({ id, state, readOnlyReason }: { id?: string; state?: string; readOnlyReason: AccessReason | null }) {
    const tUsage = useTranslations('mobileProviders.usage')
    const view = VIEWS[state ?? 'full'] ?? AI_CONNECTIONS_FULL
    const connection = view.connections.find(candidate => candidate.id === id) ?? view.connections[0]
    const [key, setKey] = useState('')
    const remove = () =>
        Alert.alert(`Remove ${connection.name}?`, describeUsage(MOCK_USAGE, tUsage), [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive' },
        ])
    const rename = () => Alert.prompt('Rename', undefined, noop, 'plain-text', connection.name)
    return <ConnectionDetail connection={connection} view={view} error={null} onBack={back} onRename={rename} onModels={noop} onBaseUrl={noop} onExtraModels={noop} onSignInAgain={noop} replacement={{ key, onKey: setKey, busy: false, error: null, onSave: noop }} onRemove={remove} readOnlyReason={readOnlyReason} />
}

const ERRORS = [
    'claude 401: {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
    "You've hit your session limit · resets 4pm",
    '402 Payment Required: {"error":"rerun_budget_exhausted"}',
    'Request timed out',
]

function ErrorsLab() {
    return (
        <SheetFrame title="Chat errors" onBack={back}>
            {ERRORS.map(message => (
                <View key={message} style={{ gap: spacing.sm }}>
                    <AppText variant="caption" tone="muted">
                        {message}
                    </AppText>
                    <ErrorCard message={message} onRetry={noop} onReconnect={noop} onSwitchModel={noop} onConnect={noop} />
                </View>
            ))}
        </SheetFrame>
    )
}

export default function ProvidersLab() {
    const params = useLocalSearchParams<{ screen?: string; state?: string; id?: string; provider?: string; only?: 'plan' | 'key'; ending?: string; role?: 'member' }>()
    const member = params.role === 'member'
    const readOnlyReason = member ? AI_PROVIDERS_ADMIN_ONLY : null
    const role = member ? '&role=member' : ''
    const view = VIEWS[params.state ?? 'full'] ?? AI_CONNECTIONS_FULL
    const pick = (provider: AddableProvider) => router.push(provider === 'claude' ? '/lab-providers?screen=claude' : provider === 'codex' ? '/lab-providers?screen=chatgpt' : `/lab-providers?screen=key&provider=${provider}`)

    switch (params.screen) {
        case 'add':
            if (member) return <ProvidersAdminOnly />
            return <AddProvider addable={AI_CONNECTIONS_FULL.addable} only={params.only} onPick={pick} onBack={back} />
        case 'claude':
            return <ClaudeLab key={`${params.state}-${params.ending}`} state={params.state} ending={params.ending} />
        case 'chatgpt':
            return <ChatGptLab key={`${params.state}-${params.ending}`} state={params.state} ending={params.ending} />
        case 'key':
            return <KeyLab key={`${params.provider}-${params.state}`} provider={params.provider} state={params.state} />
        case 'detail':
            return <DetailLab key={`${params.id}-${params.state}-${params.role}`} id={params.id} state={params.state} readOnlyReason={readOnlyReason} />
        case 'default':
            return <DefaultModelPicker view={view} onPick={back} onBack={back} />
        case 'errors':
            return <ErrorsLab />
        default:
            return (
                <ProvidersList
                    view={params.state === 'loading' || params.state === 'failed' ? null : view}
                    failed={params.state === 'failed'}
                    readOnlyReason={readOnlyReason}
                    onClose={back}
                    onOpen={id => router.push(`/lab-providers?screen=detail&id=${id}&state=${params.state ?? 'full'}${role}`)}
                    onAdd={pick}
                    onAddKind={kind => router.push(`/lab-providers?screen=add&only=${kind}`)}
                    onChangeDefault={() => router.push(`/lab-providers?screen=default&state=${params.state ?? 'full'}`)}
                />
            )
    }
}
