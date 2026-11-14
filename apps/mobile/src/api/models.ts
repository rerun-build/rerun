import { agentModelsSchema, type AgentModels, type Provider, type SetAgentModelInput } from '@rerun/contracts'

import { api } from '@/api/client'
import type { ModelProvider } from '@/mocks/models'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAgentModels(caller: Caller, agentId: string): Promise<AgentModels> {
    return agentModelsSchema.parse(await api(`/api/v1/agents/${encodeURIComponent(agentId)}/models`, caller))
}

export async function setAgentModel(caller: Caller, agentId: string, choice: SetAgentModelInput): Promise<void> {
    await api(`/api/v1/agents/${encodeURIComponent(agentId)}/model`, { ...caller, method: 'PUT', body: choice })
}

export function logoOf(provider: Provider): ModelProvider {
    if (provider === 'rerun' || provider === 'openrouter') return 'rerun'
    if (provider === 'anthropic' || provider === 'claude') return 'claude'
    if (provider === 'openai' || provider === 'codex') return 'codex'
    if (provider === 'opencode') return 'opencode'
    return 'google'
}

export function runningModel(models: AgentModels | null): { id: string; label: string; provider: ModelProvider } | undefined {
    const running = models?.resolved ?? models?.boxDefault
    if (!models || !running) return undefined
    const group = models.groups.find(entry => entry.connectionId === running.connectionId)
    const model = group?.models.find(entry => entry.id === running.model)
    return group ? { id: running.model, label: model?.label ?? running.model, provider: logoOf(group.provider) } : undefined
}
