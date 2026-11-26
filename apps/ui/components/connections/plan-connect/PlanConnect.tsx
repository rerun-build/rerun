'use client'

import type { AiConnectionSurface } from '@rerun/analytics'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { useClaudeOAuth } from '@/components/connections/use-claude-oauth'
import { useCodexDeviceAuth } from '@/components/connections/use-codex-device-auth'
import { useGrokDeviceAuth, type GrokSignInTarget } from '@/components/connections/use-grok-device-auth'

import { ChatGptPlanSteps } from './ChatGptPlanSteps'
import { ClaudePlanSteps } from './ClaudePlanSteps'
import { GrokPlanSteps } from './GrokPlanSteps'
import type { TrackStep } from './ForemanTrack'

type MutationResult = { success: boolean; error?: string }

type PlanConnectProps = {
    provider: SubscriptionProvider
    // Where the token lands: a new connection, or an existing one signed in again.
    onKeys: (keys: Record<string, string>) => Promise<MutationResult>
    // Grok's sign-in is stored by the hub itself: the caller only learns which connection holds it,
    // and says up front where it should land.
    onSignedIn: (connectionId: string) => Promise<MutationResult>
    target: GrokSignInTarget
    surface: AiConnectionSurface
    lastStep: (linked: boolean) => TrackStep
}

export function PlanConnect({ provider, ...props }: PlanConnectProps) {
    if (provider === 'grok') return <GrokPlanConnect {...props} />
    return provider === 'claude' ? <ClaudePlanConnect {...props} /> : <ChatGptPlanConnect {...props} />
}

type ProviderConnectProps = Omit<PlanConnectProps, 'provider'>

function ClaudePlanConnect({ onKeys, surface, lastStep }: ProviderConnectProps) {
    const oauth = useClaudeOAuth(onKeys, surface)
    return <ClaudePlanSteps oauth={oauth} lastStep={lastStep} />
}

function ChatGptPlanConnect({ onKeys, surface, lastStep }: ProviderConnectProps) {
    const auth = useCodexDeviceAuth(onKeys, surface)
    return <ChatGptPlanSteps auth={auth} lastStep={lastStep} />
}

function GrokPlanConnect({ onSignedIn, target, surface, lastStep }: ProviderConnectProps) {
    const auth = useGrokDeviceAuth(onSignedIn, surface, target)
    return <GrokPlanSteps auth={auth} lastStep={lastStep} />
}
