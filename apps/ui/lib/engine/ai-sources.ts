import { rerunCreditTotalMicros, type RerunCreditColumns } from '@rerun/cloud/billing'
import { catalogFor, modelLabel, modelPower, type CatalogModel } from '@/lib/engine/models'
import type { BoxConnection, BoxDefault } from '@/lib/engine/types'
import { shortUntil } from '@/lib/time'
import { formatNumber, shortDate } from '@rerun/i18n/format'
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

type PlanWindowCopy = 'session' | 'fiveHour' | 'weekly' | 'monthly' | 'modelWeekly' | 'modelWeeklyUnnamed'
type CliUnavailableCopy = 'opencodeRetired' | 'codexOutdated' | 'notInChatgptPlan'

export type SourceCopy = (
    key:
        | `sources.kinds.${SourceKind}`
        | `sources.pitch.${AddableProvider}.${'title' | 'hint'}`
        | `sources.guide.${GuidedProvider}.${'title' | 'step1' | 'step2' | 'step3'}`
        | `sources.windows.${PlanWindowCopy}`
        | `sources.tiers.${'fast' | 'smart'}`
        | `sources.opencodePlan.${OpencodePlan}`
        | `sources.unavailable.${CliUnavailableCopy}`
        | 'sources.summary'
        | 'sources.summaryWindow'
        | 'sources.creditPaused'
        | 'sources.creditUsed'
        | 'sources.creditUsedUpOn'
        | 'sources.creditUsedUpNextMonth'
        | 'sources.creditBackOn'
        | 'sources.creditBackNextMonth'
        | 'sources.windowResets'
        | 'sources.pricePerMillion',
    values?: Record<string, string | number>
) => string

export function providerPitch(provider: AddableProvider, t: SourceCopy): { title: string; hint: string } {
    return { title: t(`sources.pitch.${provider}.title`), hint: t(`sources.pitch.${provider}.hint`) }
}

// Numbered steps rendered by CredentialGuide, the same fold the service credentials use.
export function providerGuide(provider: GuidedProvider, t: SourceCopy): { title: string; steps: string } {
    const steps = ([1, 2, 3] as const).map(step => `${step}. ${t(`sources.guide.${provider}.step${step}`)}`)
    return { title: t(`sources.guide.${provider}.title`), steps: steps.join('\n') }
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

export function isCreditUsedUp(credit: RerunCredit) {
    return credit.budgetMicros > 0 && credit.usedMicros >= credit.budgetMicros
}

// Set inside a sentence of the iOS app ("back {backOn}"), which is why it carries its own preposition.
export function creditResetPhrase(credit: RerunCredit, t: SourceCopy, locale: string) {
    return credit.resetAt ? t('sources.creditBackOn', { date: shortDate(credit.resetAt, locale) }) : t('sources.creditBackNextMonth')
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
export function cliUnavailableReason(connection: Pick<BoxConnection, 'provider' | 'cliModels'> & Partial<Pick<BoxConnection, 'providerModels'>>, model: string, t: SourceCopy): string | undefined {
    if (!opencodeServesModel(connection.provider, connection.providerModels, model)) return t('sources.unavailable.opencodeRetired')
    if (cliServesModel(connection.provider, connection.cliModels, model)) return undefined
    return connection.cliModels?.outdated ? t('sources.unavailable.codexOutdated') : t('sources.unavailable.notInChatgptPlan')
}

// What the billing dialog is told opened it, for the funnel.
export const PREMIUM_MODEL_BILLING_TRIGGER = 'premium_model'

// None for Balanced: alone in its list, it reads as a plain "Rerun" row.
const RERUN_TIER_DESCRIPTION: Partial<Record<RerunTier, 'fast' | 'smart'>> = { fast: 'fast', smart: 'smart' }

// What an OpenCode model costs on top of the plan, beside its name in every picker: a Go model is
// paid by the subscription, a Console one by the account's credits. Plan-scoped ids only.
export function opencodePlanDescription(provider: string, model: string, t: SourceCopy): string | undefined {
    if (provider !== 'opencode') return undefined
    const plan = opencodePlanOf(model)
    return plan ? t(`sources.opencodePlan.${plan}`) : undefined
}

// The line under a model's name in a picker: a Rerun tier's hint, or what an OpenCode model is paid with.
export function modelDescription(connection: Pick<BoxConnection, 'id' | 'provider'>, model: string, t: SourceCopy): string | undefined {
    return rerunTierDescription(connection.id, model, t) ?? opencodePlanDescription(connection.provider, model, t)
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
export function opencodeModelRows(source: BoxConnection, t: SourceCopy): OpencodeModelRow[] {
    const catalog = source.providerModels ?? OPENCODE_SNAPSHOT.map(toProviderModel)
    const listed = new Set(catalog.map(model => model.id))
    const retired = source.models.filter(id => !listed.has(id) && opencodePlanOf(id))
    const rows = [
        ...catalog.map(info => ({ id: info.id, label: info.label, plan: info.plan, info, isNew: !SNAPSHOT_IDS.has(info.id) })),
        ...retired.map(id => ({ id, label: modelLabel(id), plan: opencodePlanOf(id)!, info: null, isNew: false })),
    ]
    return rows.map(row => ({ ...row, enabled: isModelEnabled(source, row.id), unavailable: cliUnavailableReason(source, row.id, t) }))
}

// USD per million tokens, the way OpenCode's own pricing reads.
export function pricePerMillion(price: ProviderModel['price'], t: SourceCopy, locale: string): string {
    const usd = (value: number) => formatNumber(value, locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 3 })
    return t('sources.pricePerMillion', { input: usd(price.input), output: usd(price.output) })
}

// The hint beside a Rerun tier's name. Nothing for any other model: only the tiers get one, a
// provider's own list is too long for it.
export function rerunTierDescription(connectionId: string, model: string, t: SourceCopy): string | undefined {
    if (connectionId !== RERUN_CONNECTION_ID) return undefined
    const id = canonicalModelId(model)
    const tier = RERUN_TIERS.find(candidate => RERUN_MODELS[candidate] === id)
    const described = tier && RERUN_TIER_DESCRIPTION[tier]
    return described ? t(`sources.tiers.${described}`) : undefined
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

export type PlanLimitTone = 'brand' | 'warning' | 'destructive'

export function planLimitTone(usedPercent: number): PlanLimitTone {
    if (usedPercent >= 90) return 'destructive'
    if (usedPercent >= 75) return 'warning'
    return 'brand'
}

// OpenCode Go's rolling window is five hours long, and its plan says so.
export function planWindowName(window: PlanLimitWindow, t: SourceCopy, provider?: string): string {
    if (window.kind === 'session') return provider === 'opencode' ? t('sources.windows.fiveHour') : t('sources.windows.session')
    if (window.kind === 'weekly') return t('sources.windows.weekly')
    if (window.kind === 'monthly') return t('sources.windows.monthly')
    return window.label ? t('sources.windows.modelWeekly', { label: window.label }) : t('sources.windows.modelWeeklyUnnamed')
}

export function planWindowPercent(window: PlanLimitWindow): string {
    return `${Math.round(window.usedPercent)}%`
}

export function planWindowReset(window: PlanLimitWindow, t: SourceCopy, locale: string): string | null {
    return window.resetsAt ? t('sources.windowResets', { when: shortUntil(window.resetsAt, locale) }) : null
}

function creditSummary(credit: RerunCredit, t: SourceCopy, locale: string): string {
    if (credit.paused) return t('sources.creditPaused')
    if (!isCreditUsedUp(credit)) return t('sources.creditUsed', { percent: credit.percent })
    return credit.resetAt ? t('sources.creditUsedUpOn', { date: shortDate(credit.resetAt, locale) }) : t('sources.creditUsedUpNextMonth')
}

export function sourceSummary(source: BoxConnection, credit: RerunCredit, t: SourceCopy, locale: string): string {
    if (source.id === RERUN_CONNECTION_ID) return creditSummary(credit, t, locale)
    const planWindows = livePlanWindows(source).filter(window => window.kind !== 'model')
    if (planWindows.length) return planWindows.map(window => t('sources.summaryWindow', { name: planWindowName(window, t, source.provider), percent: planWindowPercent(window) })).join(' · ')
    const kind = source.provider === 'custom' ? t('sources.pitch.custom.title') : t(`sources.kinds.${sourceKind(source.provider)}`)
    return t('sources.summary', { kind, count: enabledModels(source).length })
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
