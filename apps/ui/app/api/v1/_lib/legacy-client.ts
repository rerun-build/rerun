import { type AgentModels, type AgentView, type AiConnectionsView, type Provider } from '@rerun/contracts'
import { clientOf } from './client-platform'

const FIRST_IOS_BUILD_ENV: Partial<Record<Provider, string>> = {
    opencode: 'MOBILE_IOS_OPENCODE_BUILD',
    custom: 'MOBILE_IOS_CUSTOM_BUILD',
}

const PROVIDERS_UNKNOWN_TO_LEGACY = Object.keys(FIRST_IOS_BUILD_ENV) as Provider[]

function firstIosBuild(provider: Provider): number | null {
    const name = FIRST_IOS_BUILD_ENV[provider]
    const build = Number.parseInt((name && process.env[name]) ?? '', 10)
    return Number.isInteger(build) && build > 0 ? build : null
}

export function clientKnowsProvider(req: Request, provider: Provider): boolean {
    if (!FIRST_IOS_BUILD_ENV[provider]) return true
    const client = clientOf(req)
    if (client?.platform === 'android') return true
    const firstBuild = firstIosBuild(provider)
    if (!client || firstBuild === null) return false
    return client.build >= firstBuild
}

function unknownTo(req: Request): ((provider: Provider | null | undefined) => boolean) | null {
    const unknown = new Set(PROVIDERS_UNKNOWN_TO_LEGACY.filter(provider => !clientKnowsProvider(req, provider)))
    return unknown.size ? provider => !!provider && unknown.has(provider) : null
}

export function aiConnectionsForClient(req: Request, view: AiConnectionsView): AiConnectionsView {
    const unknownToLegacy = unknownTo(req)
    if (!unknownToLegacy) return view
    return {
        ...view,
        connections: view.connections.filter(connection => !unknownToLegacy(connection.provider)),
        addable: view.addable.filter(entry => !unknownToLegacy(entry.provider)),
    }
}

export function agentModelsForClient(req: Request, models: AgentModels): AgentModels {
    const unknownToLegacy = unknownTo(req)
    if (!unknownToLegacy) return models
    return { ...models, groups: models.groups.filter(group => !unknownToLegacy(group.provider)) }
}

export function agentViewForClient(req: Request, view: AgentView): AgentView {
    const unknownToLegacy = unknownTo(req)
    if (!unknownToLegacy || !view.detail) return view
    const { detail } = view
    const config = unknownToLegacy(detail.config.provider) ? { ...detail.config, provider: null, model: null } : detail.config
    const resolved = unknownToLegacy(detail.resolvedProvider) ? { resolvedProvider: null, resolvedModel: null } : {}
    return { ...view, detail: { ...detail, config, ...resolved } }
}
