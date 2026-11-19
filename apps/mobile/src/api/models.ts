import { mobileApi, type AgentModels, type Provider, type SetAgentModelInput } from '@rerun/contracts'

import { hub } from '@/api/client'
import type { ModelProvider } from '@/mocks/models'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAgentModels(caller: Caller, agentId: string): Promise<AgentModels> {
    return hub(mobileApi.getAgentModels, { ...caller, params: { id: agentId } })
}

export async function setAgentModel(caller: Caller, agentId: string, choice: SetAgentModelInput): Promise<void> {
    await hub(mobileApi.setAgentModel, { ...caller, params: { id: agentId }, body: choice })
}

// The mark a connection's provider shows under: five logos cover every provider the engine runs.
export function logoOf(provider: Provider): ModelProvider {
    if (provider === 'rerun' || provider === 'openrouter') return 'rerun'
    if (provider === 'anthropic' || provider === 'claude') return 'claude'
    if (provider === 'openai' || provider === 'codex') return 'codex'
    if (provider === 'opencode') return 'opencode'
    return 'google'
}

// The model a coworker runs today, as the chip names it.
export function runningModel(models: AgentModels | null): { id: string; label: string; provider: ModelProvider } | undefined {
    const running = models?.resolved ?? models?.boxDefault
    if (!models || !running) return undefined
    const group = models.groups.find(entry => entry.connectionId === running.connectionId)
    const model = group?.models.find(entry => entry.id === running.model)
    return group ? { id: running.model, label: model?.label ?? running.model, provider: logoOf(group.provider) } : undefined
}
