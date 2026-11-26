import { type AgentModels, type AgentView, type AiConnectionsView, type BoardAgent, type ClientPlatform, COWORKER_COLORS, type EmailCodePrepared, nearestHashedCoworkerColor, type Provider } from '@rerun/contracts'
import { clientOf } from './client-platform'

// The builds already in people's hands parse `providerSchema` strictly: one provider they do not know
// anywhere in a response fails the whole parse, and with it as the machine's default that is every
// coworker's sheet. Until the build that knows a provider is the minimum, the routes those builds read
// leave it out. Each provider names, per platform, the env var holding its first build; unset, every
// build of that platform is treated as one that does not know it. A platform it does not name was
// born knowing it: the Android app came after OpenCode and custom endpoints, not after Grok.
const FIRST_BUILD_ENV: Partial<Record<Provider, Partial<Record<ClientPlatform, string>>>> = {
    opencode: { ios: 'MOBILE_IOS_OPENCODE_BUILD' },
    custom: { ios: 'MOBILE_IOS_CUSTOM_BUILD' },
    grok: { ios: 'MOBILE_IOS_GROK_BUILD', android: 'MOBILE_ANDROID_GROK_BUILD' },
}

const PROVIDERS_UNKNOWN_TO_LEGACY = Object.keys(FIRST_BUILD_ENV) as Provider[]

function firstBuild(name: string): number | null {
    const build = Number.parseInt(process.env[name] ?? '', 10)
    return Number.isInteger(build) && build > 0 ? build : null
}

// A request without the header is an old iOS build: only the app sends it, and only recent ones do.
export function clientKnowsProvider(req: Request, provider: Provider): boolean {
    const builds = FIRST_BUILD_ENV[provider]
    if (!builds) return true
    const client = clientOf(req)
    if (!client) return false
    const name = builds[client.platform]
    if (!name) return true
    const first = firstBuild(name)
    return first !== null && client.build >= first
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

// Both pairs are nullable already: an old build reads them as "follows the machine" and "not
// resolved yet", which is what it can show without knowing the provider.
export function agentViewForClient(req: Request, view: AgentView): AgentView {
    const agent = clientReadsFreeColors(req) ? view.agent : withHashedColor(view.agent)
    const dressed = agent === view.agent ? view : { ...view, agent }
    const unknownToLegacy = unknownTo(req)
    if (!unknownToLegacy || !dressed.detail) return dressed
    return providersForLegacy(dressed, unknownToLegacy)
}

function providersForLegacy(view: AgentView, unknownToLegacy: (provider: Provider | null | undefined) => boolean): AgentView {
    const { detail } = view
    if (!detail) return view
    const config = unknownToLegacy(detail.config.provider) ? { ...detail.config, provider: null, model: null } : detail.config
    const resolved = unknownToLegacy(detail.resolvedProvider) ? { resolvedProvider: null, resolvedModel: null } : {}
    return { ...view, detail: { ...detail, config, ...resolved } }
}

const FIRST_IOS_BUILD_WITHOUT_CREATED = 23

// iOS 18 to 21 read the answer of an email code only with `created` in it, and only for analytics.
// Always false: said true, it would tell anyone who holds an account. Goes with those builds.
export function emailCodeForClient(req: Request, answer: EmailCodePrepared): EmailCodePrepared & { created?: false } {
    const client = clientOf(req)
    if (client && (client.platform === 'android' || client.build >= FIRST_IOS_BUILD_WITHOUT_CREATED)) return answer
    return { ...answer, created: false }
}

// A build marks a conversation of the Chief of Staff read as it shows it only since the one each
// variable names: an older one would keep every finished run of it unread in its inbox. Unset, no
// build of that platform does.
const FIRST_FOREMAN_RUNS_BUILD_ENV: Record<ClientPlatform, string> = { ios: 'MOBILE_IOS_FOREMAN_RUNS_BUILD', android: 'MOBILE_ANDROID_FOREMAN_RUNS_BUILD' }

export function clientReadsForemanRuns(req: Request): boolean {
    return clientAtOrPast(req, FIRST_FOREMAN_RUNS_BUILD_ENV)
}

function clientAtOrPast(req: Request, firstBuildEnv: Record<ClientPlatform, string>): boolean {
    const client = clientOf(req)
    if (!client) return false
    const firstBuild = Number.parseInt(process.env[firstBuildEnv[client.platform]] ?? '', 10)
    return Number.isInteger(firstBuild) && firstBuild > 0 && client.build >= firstBuild
}

// A look's colour is any `#rrggbb` only since the builds these variables name: an older one parses
// it against the eight colours a coworker is hashed to, and one it does not know fails its whole
// board. It gets the closest of those eight instead. Unset, no build of that platform reads one.
const FIRST_FREE_COLOR_BUILD_ENV: Record<ClientPlatform, string> = { ios: 'MOBILE_IOS_FREE_COLOR_BUILD', android: 'MOBILE_ANDROID_FREE_COLOR_BUILD' }

const HASHED_COLORS = new Set<string>(COWORKER_COLORS)

function clientReadsFreeColors(req: Request): boolean {
    return clientAtOrPast(req, FIRST_FREE_COLOR_BUILD_ENV)
}

function withHashedColor(agent: BoardAgent): BoardAgent {
    const { look } = agent
    if (!look || HASHED_COLORS.has(look.color)) return agent
    return { ...agent, look: { ...look, color: nearestHashedCoworkerColor(look.color) } }
}

export function boardAgentsForClient(req: Request, agents: BoardAgent[]): BoardAgent[] {
    return clientReadsFreeColors(req) ? agents : agents.map(withHashedColor)
}
