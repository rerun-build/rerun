import { rerunCreditTotalMicros, type RerunCreditColumns } from '@rerun/cloud/billing'
import { catalogFor, modelLabel, modelPower, type CatalogModel } from '@/lib/engine/models'
import type { BoxConnection, BoxDefault } from '@/lib/engine/types'
import { shortUntil } from '@/lib/time'
import { PROVIDER_LABELS, RERUN_CONNECTION_ID, RERUN_MODEL, RERUN_MODELS, RERUN_TIERS, OPENCODE_SNAPSHOT, canonicalModelId, cliServesModel, isPremiumModel, opencodePlanOf, opencodeServesModel, toProviderModel, type OpencodePlan, type ProviderModel, type PlanLimitWindow, type Provider, type RerunTier } from '@rerun/contracts'

// The AI providers dialog sorts every connection by who pays for it: the credit included with
// Rerun, the user's own subscription, or the user's own API key.
export type SourceKind = 'included' | 'plan' | 'key'

export type AddableProvider = Exclude<Provider, 'rerun'>

// The API key providers with a key to fetch from a console. A custom endpoint is listed beside them
// but asks for its address first, and its key is optional.
export type KeyProvider = Exclude<AddableProvider, 'claude' | 'codex' | 'opencode' | 'custom'>

// The providers connected by pasting a key, whose page walks the user through getting one. OpenCode
// is one of them while it sells a plan: it sits with the subscriptions, not with the API keys.
export type GuidedProvider = KeyProvider | 'opencode'

export function sourceKind(provider: string): SourceKind {
    const section = catalogFor(provider).section
    return section === 'free' ? 'included' : section === 'subscription' ? 'plan' : 'key'
}

// How a provider is connected, and therefore how it is connected again once its credential is
// turned away. A comparison on the provider name alone sent OpenCode to Claude's sign-in.
export type ConnectMethod = 'oauth-claude' | 'device-codex' | 'key'

export function connectMethod(provider: string): ConnectMethod {
    if (provider === 'claude') return 'oauth-claude'
    if (provider === 'codex') return 'device-codex'
    return 'key'
}

export const KIND_LABEL: Record<SourceKind, string> = { included: 'Included', plan: 'Plan', key: 'API key' }

export const PROVIDER_PITCH: Record<AddableProvider, { title: string; hint: string }> = {
    claude: { title: 'Claude Pro or Max', hint: 'Sign in with your Claude account' },
    codex: { title: 'ChatGPT Plus or Pro', hint: 'Sign in with your ChatGPT account' },
    anthropic: { title: 'Anthropic', hint: 'Claude models, billed per token' },
    openai: { title: 'OpenAI', hint: 'GPT models, billed per token' },
    google: { title: 'Google', hint: 'Gemini models, billed per token' },
    openrouter: { title: 'OpenRouter', hint: 'Every model behind one key' },
    opencode: { title: 'OpenCode Go or Console', hint: 'Paste your OpenCode key' },
    custom: { title: 'Custom endpoint', hint: 'Ollama, LM Studio, vLLM or any OpenAI-compatible server' },
}

// Numbered steps rendered by CredentialGuide, the same fold the service credentials use.
export const PROVIDER_GUIDE: Record<GuidedProvider, { title: string; steps: string }> = {
    anthropic: {
        title: 'How to get your Anthropic key',
        steps: [
            '1. Open the [Anthropic Console](https://console.anthropic.com/settings/keys) and sign in.',
            '2. Click **Create Key** and name it, for example "Rerun".',
            '3. Copy the key (it starts with `sk-ant-`) and paste it above. It is shown only once.',
        ].join('\n'),
    },
    openai: {
        title: 'How to get your OpenAI key',
        steps: [
            '1. Open [OpenAI API keys](https://platform.openai.com/api-keys) and sign in.',
            '2. Click **Create new secret key** and name it, for example "Rerun".',
            '3. Copy the key (it starts with `sk-`) and paste it above. It is shown only once.',
        ].join('\n'),
    },
    google: {
        title: 'How to get your Google key',
        steps: [
            '1. Open [Google AI Studio](https://aistudio.google.com/apikey) and sign in with your Google account.',
            '2. Click **Create API key** and pick a Google Cloud project.',
            '3. Copy the key and paste it above.',
        ].join('\n'),
    },
    openrouter: {
        title: 'How to get your OpenRouter key',
        steps: [
            '1. Open [OpenRouter keys](https://openrouter.ai/keys) and sign in.',
            '2. Click **Create API Key**, and add credits if your balance is empty.',
            '3. Copy the key (it starts with `sk-or-`) and paste it above. It is shown only once.',
        ].join('\n'),
    },
    opencode: {
        title: 'How to get your OpenCode key',
        steps: [
            '1. Open [OpenCode](https://opencode.ai/auth) and sign in.',
            '2. Subscribe to **OpenCode Go**, or add credits to use the Console models.',
            '3. Create an API key, copy it (it starts with `oc_sk_`) and paste it above.',
        ].join('\n'),
    },
}

export const PLAN_PROVIDERS: AddableProvider[] = ['claude', 'codex']

// OpenCode joins the subscriptions only where it can run: behind its release flag, on a machine
// whose engine says it knows the provider.
export function planProviders(opencodeOffered: boolean): AddableProvider[] {
    return opencodeOffered ? [...PLAN_PROVIDERS, 'opencode'] : PLAN_PROVIDERS
}
export const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'google', 'openrouter']

// A custom endpoint joins the API keys only on a machine whose engine runs it.
export function keyProviders(customOffered: boolean): AddableProvider[] {
    return customOffered ? [...KEY_PROVIDERS, 'custom'] : KEY_PROVIDERS
}

export const PLAN_LABELS: Partial<Record<AddableProvider, string>> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

const PLAN_NAMES: Partial<Record<Provider, string>> = { claude: 'Claude', codex: 'ChatGPT', opencode: 'OpenCode' }

export const RERUN_FALLBACK: BoxDefault = { connectionId: RERUN_CONNECTION_ID, model: RERUN_MODEL }

// What agents with no model of their own run on: a fresh workspace has no default, and runs on Rerun.
export function effectiveDefault(boxDefault: BoxDefault | null): BoxDefault {
    return boxDefault ?? RERUN_FALLBACK
}

// `paused`: a member turned the credit off, and the hub refuses every Rerun call until it is resumed.
export type RerunCredit = { usedMicros: number; budgetMicros: number; resetAt: string | null; percent: number; paused?: boolean }

export function rerunCreditOf(workspace: (RerunCreditColumns & { current_period_end?: string | null; rerun_credit_paused_at?: string | null }) | null | undefined): RerunCredit {
    const usedMicros = workspace?.rerun_used_micros ?? 0
    const budgetMicros = rerunCreditTotalMicros(workspace)
    const percent = budgetMicros > 0 ? Math.min(100, Math.round((usedMicros / budgetMicros) * 100)) : 0
    return { usedMicros, budgetMicros, resetAt: workspace?.current_period_end ?? null, percent, paused: !!workspace?.rerun_credit_paused_at }
}

export const RERUN_CREDIT_PAUSED_REASON = 'Rerun credits are paused'

export function isCreditUsedUp(credit: RerunCredit) {
    return credit.budgetMicros > 0 && credit.usedMicros >= credit.budgetMicros
}

export function creditResetPhrase(credit: RerunCredit) {
    return credit.resetAt ? `on ${new Date(credit.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'next month'
}

// Rerun offers Balanced alone for now, shown as "Rerun". The boxes still list Fast and Smart and the
// hub still serves them, so what is already pinned on one keeps running: only the pickers drop them.
const HIDDEN_RERUN_MODELS = new Set<string>([RERUN_MODELS.fast, RERUN_MODELS.smart])

export function isHiddenModel(connectionId: string, model: string): boolean {
    return connectionId === RERUN_CONNECTION_ID && HIDDEN_RERUN_MODELS.has(model)
}

// Extra ids are served on top of `models` by the engine, so they are always on.
// OpenCode's list is the box's live reading of its catalog when there is one, the snapshot this build
// was cut with otherwise. A custom endpoint's is what it last listed at `/models`, ids as labels.
function catalogOf(source: BoxConnection): CatalogModel[] {
    if (source.providerModels) return source.providerModels.map(m => ({ id: m.id, label: m.label }))
    if (source.discoveredModels) return source.discoveredModels.map(m => ({ id: m.id, label: m.id }))
    return catalogFor(source.provider).models
}

export function offeredModels(source: BoxConnection): CatalogModel[] {
    const catalog = catalogOf(source)
    const catalogIds = new Set(catalog.map(m => m.id))
    // A model the connection still offers that the catalog no longer lists (retired between two
    // deploys) has to stay switchable off.
    const orphans = source.models.filter(id => !catalogIds.has(id))
    const extras = source.extraModels.filter(id => !catalogIds.has(id) && !orphans.includes(id))
    const offered = [...catalog, ...[...orphans, ...extras].map(id => ({ id, label: modelLabel(id), power: modelPower(id) }))]
    return inTierOrder(source.id, offered.filter(m => !isHiddenModel(source.id, m.id)))
}

export function isModelEnabled(source: BoxConnection, modelId: string) {
    return source.models.includes(modelId) || source.extraModels.includes(modelId)
}

export function enabledModels(source: BoxConnection): CatalogModel[] {
    return offeredModels(source).filter(m => isModelEnabled(source, m.id))
}

// Balanced is labelled "Rerun" already; only a tier pinned before the others were hidden needs the prefix.
export function modelName(connectionId: string, model: string) {
    return connectionId === RERUN_CONNECTION_ID && canonicalModelId(model) !== RERUN_MODEL ? `Rerun ${modelLabel(model)}` : modelLabel(model)
}

// Before paying, the hub serves Balanced for Smart and the box steps Opus, Fable and Astra down, so
// a picker that let them through would name a model the run does not get. A locked row opens the
// plan instead.
export function isModelLocked(connectionId: string, model: string, premiumAllowed: boolean): boolean {
    if (premiumAllowed) return false
    return (connectionId === RERUN_CONNECTION_ID && model === RERUN_MODELS.smart) || isPremiumModel(model)
}

// A model the subscription's own CLI does not list on this box. Upgrading the Rerun plan would not
// bring it, so the row is disabled rather than routed to billing. Undefined when the CLI serves it,
// when it has not been asked yet, or for Claude, whose list is its picker rather than the account.
// OpenCode's counterpart is a model it stopped publishing: its own wording, since no plan of the
// user's is at stake.
export function cliUnavailableReason(connection: Pick<BoxConnection, 'provider' | 'cliModels'> & Partial<Pick<BoxConnection, 'providerModels'>>, model: string): string | undefined {
    if (!opencodeServesModel(connection.provider, connection.providerModels, model)) return 'No longer offered by OpenCode'
    if (cliServesModel(connection.provider, connection.cliModels, model)) return undefined
    return connection.cliModels?.outdated ? 'Codex CLI outdated on this box' : 'Not in your ChatGPT plan'
}

// What the billing dialog is told opened it, for the funnel.
export const PREMIUM_MODEL_BILLING_TRIGGER = 'premium_model'

// None for Balanced: alone in its list, it reads as a plain "Rerun" row.
const RERUN_TIER_DESCRIPTION: Partial<Record<RerunTier, string>> = {
    fast: 'Quick and cheap',
    smart: 'The smartest',
}

// What an OpenCode model costs on top of the plan, beside its name in every picker: a Go model is
// paid by the subscription, a Console one by the account's credits. Plan-scoped ids only.
const OPENCODE_PLAN_DESCRIPTION: Record<OpencodePlan, string> = { go: 'Included in Go', console: 'Console credits' }

export function opencodePlanDescription(provider: string, model: string): string | undefined {
    if (provider !== 'opencode') return undefined
    const plan = opencodePlanOf(model)
    return plan ? OPENCODE_PLAN_DESCRIPTION[plan] : undefined
}

// The line under a model's name in a picker: a Rerun tier's hint, or what an OpenCode model is paid with.
export function modelDescription(connection: Pick<BoxConnection, 'id' | 'provider'>, model: string): string | undefined {
    return rerunTierDescription(connection.id, model) ?? opencodePlanDescription(connection.provider, model)
}

// Go before Console, each in the order it came: the models the plan pays for come first.
export function inPlanOrder<T extends { id: string }>(provider: string, models: T[]): T[] {
    if (provider !== 'opencode') return models
    const rank = (id: string) => (opencodePlanOf(id) === 'console' ? 1 : 0)
    return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

// One row of an OpenCode connection's model list. `info` is null for a model the catalog no longer
// lists, still switched on: it stays there to be switched off.
export type OpencodeModelRow = { id: string; label: string; plan: OpencodePlan; info: ProviderModel | null; isNew: boolean; enabled: boolean; unavailable?: string }

const SNAPSHOT_IDS = new Set(OPENCODE_SNAPSHOT.map(model => model.id))

// What an OpenCode connection lists: the box's live catalog, or the snapshot this build was cut with.
// A model newer than that snapshot is "New": OpenCode published it after the connection was set up,
// so it was not switched on with the others.
export function opencodeModelRows(source: BoxConnection): OpencodeModelRow[] {
    const catalog = source.providerModels ?? OPENCODE_SNAPSHOT.map(toProviderModel)
    const listed = new Set(catalog.map(model => model.id))
    const retired = source.models.filter(id => !listed.has(id) && opencodePlanOf(id))
    const rows = [
        ...catalog.map(info => ({ id: info.id, label: info.label, plan: info.plan, info, isNew: !SNAPSHOT_IDS.has(info.id) })),
        ...retired.map(id => ({ id, label: modelLabel(id), plan: opencodePlanOf(id)!, info: null, isNew: false })),
    ]
    return rows.map(row => ({ ...row, enabled: isModelEnabled(source, row.id), unavailable: cliUnavailableReason(source, row.id) }))
}

// USD per million tokens, the way OpenCode's own pricing reads.
export function pricePerMillion(price: ProviderModel['price']): string {
    const usd = (value: number) => `$${Number(value.toFixed(3))}`
    return `${usd(price.input)} in · ${usd(price.output)} out /M`
}

// The hint beside a Rerun tier's name. Nothing for any other model: only the tiers get one, a
// provider's own list is too long for it.
export function rerunTierDescription(connectionId: string, model: string): string | undefined {
    if (connectionId !== RERUN_CONNECTION_ID) return undefined
    const id = canonicalModelId(model)
    const tier = RERUN_TIERS.find(candidate => RERUN_MODELS[candidate] === id)
    return tier && RERUN_TIER_DESCRIPTION[tier]
}

// Fast, Balanced, Smart, whatever order the box stores them in: its own list starts with Balanced,
// because the first entry is what the connection runs when no model is named.
export function inTierOrder<T extends { id: string }>(connectionId: string, models: T[]): T[] {
    if (connectionId !== RERUN_CONNECTION_ID) return models
    const rank = (id: string) => {
        const at = RERUN_TIERS.findIndex(tier => RERUN_MODELS[tier] === id)
        return at === -1 ? RERUN_TIERS.length : at
    }
    return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

export function isCreditExhausted(source: BoxConnection, credit: RerunCredit) {
    return source.id === RERUN_CONNECTION_ID && isCreditUsedUp(credit)
}

export function isRerunPaused(source: BoxConnection, credit: RerunCredit) {
    return source.id === RERUN_CONNECTION_ID && !!credit.paused
}

export function isUsable(source: BoxConnection, credit: RerunCredit) {
    return source.connected && !source.credentialRejected && !isCreditExhausted(source, credit) && !isRerunPaused(source, credit)
}

// Where a subscription stands against its plan, as of now rather than as of the reading: a window
// whose reset has passed since then starts over empty, and its next reset is not known yet.
export function livePlanWindows(source: Pick<BoxConnection, 'planLimits'>, now = Date.now()): PlanLimitWindow[] {
    return (source.planLimits?.windows ?? []).map(window => (window.resetsAt && Date.parse(window.resetsAt) <= now ? { ...window, usedPercent: 0, resetsAt: null } : window))
}

// The window that runs out first is the one a single gauge has to show.
export function tightestPlanWindow(windows: PlanLimitWindow[]): PlanLimitWindow | null {
    return windows.reduce<PlanLimitWindow | null>((tightest, window) => (!tightest || window.usedPercent > tightest.usedPercent ? window : tightest), null)
}

// What the model pill draws around its logo: the session inside, and outside the longer window that
// runs out first. A plan with a single window, or the Rerun credit, fills one ring on its own.
export type PillUsage = { inner: number; outer: number | null; summary: string }

export function pillUsage(group: { connectionId: string; provider?: string; planWindows: PlanLimitWindow[] }, credit: RerunCredit): PillUsage | null {
    if (group.connectionId === RERUN_CONNECTION_ID) {
        if (credit.paused || credit.budgetMicros <= 0) return null
        return { inner: credit.percent, outer: null, summary: `Monthly credits ${credit.percent}% used` }
    }
    const session = group.planWindows.find(window => window.kind === 'session')
    const longest = tightestPlanWindow(group.planWindows.filter(window => window.kind !== 'session'))
    const inner = session ?? longest
    if (!inner) return null
    const outer = session ? longest : null
    const summary = [inner, outer].flatMap(window => (window ? [`${planWindowName(window, group.provider)} ${planWindowPercent(window)} used`] : [])).join(', ')
    return { inner: inner.usedPercent, outer: outer?.usedPercent ?? null, summary }
}

export type PlanLimitTone = 'brand' | 'warning' | 'destructive'

export function planLimitTone(usedPercent: number): PlanLimitTone {
    if (usedPercent >= 90) return 'destructive'
    if (usedPercent >= 75) return 'warning'
    return 'brand'
}

// OpenCode Go's rolling window is five hours long, and its plan says so.
export function planWindowName(window: PlanLimitWindow, provider?: string): string {
    if (window.kind === 'session') return provider === 'opencode' ? '5-hour' : 'Session'
    if (window.kind === 'weekly') return 'Weekly'
    if (window.kind === 'monthly') return 'Monthly'
    return window.label ? `${window.label} weekly` : 'Model weekly'
}

export function planWindowPercent(window: PlanLimitWindow): string {
    return `${Math.round(window.usedPercent)}%`
}

export function planWindowReset(window: PlanLimitWindow): string | null {
    return window.resetsAt ? `resets ${shortUntil(window.resetsAt)}` : null
}

export function sourceSummary(source: BoxConnection, credit: RerunCredit): string {
    if (source.id === RERUN_CONNECTION_ID && credit.paused) return RERUN_CREDIT_PAUSED_REASON
    if (source.id === RERUN_CONNECTION_ID) return isCreditUsedUp(credit) ? `Monthly credits used up, back ${creditResetPhrase(credit)}` : `${credit.percent}% of this month's credits used`
    const planWindows = livePlanWindows(source).filter(window => window.kind !== 'model')
    if (planWindows.length) return planWindows.map(window => `${planWindowName(window, source.provider)} ${planWindowPercent(window)}`).join(' · ')
    const count = enabledModels(source).length
    const models = count === 1 ? '1 model' : `${count} models`
    return `${source.provider === 'custom' ? PROVIDER_PITCH.custom.title : KIND_LABEL[sourceKind(source.provider)]} · ${models}`
}

// "Claude", then "Claude 2": a name is what tells two subscriptions of the same provider apart in
// every model picker, so it must never come out identical to one already there.
export function suggestName(provider: Provider, taken: string[]): string {
    return uniqueName(PLAN_NAMES[provider] ?? PROVIDER_LABELS[provider], taken)
}

export function uniqueName(base: string, taken: string[]): string {
    if (!taken.includes(base)) return base
    for (let n = 2; ; n += 1) {
        const candidate = `${base} ${n}`
        if (!taken.includes(candidate)) return candidate
    }
}
