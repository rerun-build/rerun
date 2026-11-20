import { moldwrightCreditTotalMicros, type MoldwrightCreditColumns } from '@moldwright/cloud/billing'
import { catalogFor, modelLabel, modelPower, type CatalogModel } from '@/lib/engine/models'
import type { BoxConnection, BoxDefault } from '@/lib/engine/types'
import { shortUntil } from '@/lib/time'
import { formatNumber, shortDate } from '@moldwright/i18n/format'
import { PROVIDER_LABELS, RERUN_CONNECTION_ID, RERUN_MODEL, RERUN_MODELS, RERUN_TIERS, OPENCODE_SNAPSHOT, canonicalModelId, cliServesModel, isFreeOpencodeModel, isPremiumModel, opencodePlanOf, opencodeServesModel, toProviderModel, type OpencodePlan, type ProviderModel, type PlanLimitWindow, type Provider, type MoldwrightTier } from '@moldwright/contracts'

export type SourceKind = 'included' | 'plan' | 'key'

export type AddableProvider = Exclude<Provider, 'rerun'>

export type KeyProvider = Exclude<AddableProvider, 'claude' | 'codex' | 'opencode' | 'custom'>

export type GuidedProvider = KeyProvider | 'opencode'

export function sourceKind(provider: string): SourceKind {
    const section = catalogFor(provider).section
    return section === 'free' ? 'included' : section === 'subscription' ? 'plan' : 'key'
}

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
        | `sources.opencodePlan.${OpencodePlan | 'free'}`
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

export function providerGuide(provider: GuidedProvider, t: SourceCopy): { title: string; steps: string } {
    const steps = ([1, 2, 3] as const).map(step => `${step}. ${t(`sources.guide.${provider}.step${step}`)}`)
    return { title: t(`sources.guide.${provider}.title`), steps: steps.join('\n') }
}

export const PLAN_PROVIDERS: AddableProvider[] = ['claude', 'codex']

export function planProviders(opencodeOffered: boolean): AddableProvider[] {
    return opencodeOffered ? [...PLAN_PROVIDERS, 'opencode'] : PLAN_PROVIDERS
}
export const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'google', 'openrouter']

export function keyProviders(customOffered: boolean): AddableProvider[] {
    return customOffered ? [...KEY_PROVIDERS, 'custom'] : KEY_PROVIDERS
}

export const PLAN_LABELS: Partial<Record<AddableProvider, string>> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

const PLAN_NAMES: Partial<Record<Provider, string>> = { claude: 'Claude', codex: 'ChatGPT', opencode: 'OpenCode' }

export const RERUN_FALLBACK: BoxDefault = { connectionId: RERUN_CONNECTION_ID, model: RERUN_MODEL }

export function effectiveDefault(boxDefault: BoxDefault | null): BoxDefault {
    return boxDefault ?? RERUN_FALLBACK
}

export type MoldwrightCredit = { usedMicros: number; budgetMicros: number; resetAt: string | null; percent: number; paused?: boolean }

export function moldwrightCreditOf(workspace: (MoldwrightCreditColumns & { current_period_end?: string | null; rerun_credit_paused_at?: string | null }) | null | undefined): MoldwrightCredit {
    const usedMicros = workspace?.rerun_used_micros ?? 0
    const budgetMicros = moldwrightCreditTotalMicros(workspace)
    const percent = budgetMicros > 0 ? Math.min(100, Math.round((usedMicros / budgetMicros) * 100)) : 0
    return { usedMicros, budgetMicros, resetAt: workspace?.current_period_end ?? null, percent, paused: !!workspace?.rerun_credit_paused_at }
}

export function isCreditUsedUp(credit: MoldwrightCredit) {
    return credit.budgetMicros > 0 && credit.usedMicros >= credit.budgetMicros
}

export function creditResetPhrase(credit: MoldwrightCredit, t: SourceCopy, locale: string) {
    return credit.resetAt ? t('sources.creditBackOn', { date: shortDate(credit.resetAt, locale) }) : t('sources.creditBackNextMonth')
}

const HIDDEN_RERUN_MODELS = new Set<string>([RERUN_MODELS.fast, RERUN_MODELS.smart])

export function isHiddenModel(connectionId: string, model: string): boolean {
    return connectionId === RERUN_CONNECTION_ID && HIDDEN_RERUN_MODELS.has(model)
}

function catalogOf(source: BoxConnection): CatalogModel[] {
    if (source.providerModels) return source.providerModels.map(m => ({ id: m.id, label: m.label }))
    const fallback = catalogFor(source.provider).models
    if (!source.discoveredModels) return fallback
    const known = new Map(fallback.map(m => [m.id, m]))
    return source.discoveredModels.map(m => known.get(m.id) ?? { id: m.id, label: m.label ?? modelLabel(m.id), power: modelPower(m.id) })
}

export function offeredModels(source: BoxConnection): CatalogModel[] {
    const catalog = catalogOf(source)
    const catalogIds = new Set(catalog.map(m => m.id))
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

export function modelName(connectionId: string, model: string) {
    return connectionId === RERUN_CONNECTION_ID && canonicalModelId(model) !== RERUN_MODEL ? `Moldwright ${modelLabel(model)}` : modelLabel(model)
}

export function isModelLocked(connectionId: string, model: string, premiumAllowed: boolean): boolean {
    if (premiumAllowed) return false
    return (connectionId === RERUN_CONNECTION_ID && model === RERUN_MODELS.smart) || isPremiumModel(model)
}

export function cliUnavailableReason(connection: Pick<BoxConnection, 'provider' | 'cliModels'> & Partial<Pick<BoxConnection, 'providerModels'>>, model: string, t: SourceCopy): string | undefined {
    if (!opencodeServesModel(connection.provider, connection.providerModels, model)) return t('sources.unavailable.opencodeRetired')
    if (cliServesModel(connection.provider, connection.cliModels, model)) return undefined
    return connection.cliModels?.outdated ? t('sources.unavailable.codexOutdated') : t('sources.unavailable.notInChatgptPlan')
}

export const PREMIUM_MODEL_BILLING_TRIGGER = 'premium_model'

const RERUN_TIER_DESCRIPTION: Partial<Record<MoldwrightTier, 'fast' | 'smart'>> = { fast: 'fast', smart: 'smart' }

export function opencodePlanDescription(connection: Pick<BoxConnection, 'provider' | 'providerModels'>, model: string, t: SourceCopy): string | undefined {
    if (connection.provider !== 'opencode') return undefined
    const plan = opencodePlanOf(model)
    if (!plan) return undefined
    const catalog = connection.providerModels ?? OPENCODE_SNAPSHOT.map(toProviderModel)
    const info = catalog.find(entry => entry.id === model)
    return t(`sources.opencodePlan.${info && isFreeOpencodeModel(info.price) ? 'free' : plan}`)
}

export function modelDescription(connection: Pick<BoxConnection, 'id' | 'provider' | 'providerModels'>, model: string, t: SourceCopy): string | undefined {
    return moldwrightTierDescription(connection.id, model, t) ?? opencodePlanDescription(connection, model, t)
}

export function inPlanOrder<T extends { id: string }>(provider: string, models: T[]): T[] {
    if (provider !== 'opencode') return models
    const rank = (id: string) => (opencodePlanOf(id) === 'console' ? 1 : 0)
    return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

export type OpencodeModelRow = { id: string; label: string; plan: OpencodePlan; info: ProviderModel | null; isNew: boolean; free: boolean; enabled: boolean; unavailable?: string }

const SNAPSHOT_IDS = new Set(OPENCODE_SNAPSHOT.map(model => model.id))

export function opencodeModelRows(source: BoxConnection, t: SourceCopy): OpencodeModelRow[] {
    const catalog = source.providerModels ?? OPENCODE_SNAPSHOT.map(toProviderModel)
    const listed = new Set(catalog.map(model => model.id))
    const retired = source.models.filter(id => !listed.has(id) && opencodePlanOf(id))
    const rows = [
        ...catalog.map(info => ({ id: info.id, label: info.label, plan: info.plan, info, isNew: !SNAPSHOT_IDS.has(info.id), free: isFreeOpencodeModel(info.price) })),
        ...retired.map(id => ({ id, label: modelLabel(id), plan: opencodePlanOf(id)!, info: null, isNew: false, free: false })),
    ]
    return rows.map(row => ({ ...row, enabled: isModelEnabled(source, row.id), unavailable: cliUnavailableReason(source, row.id, t) }))
}

export function pricePerMillion(price: ProviderModel['price'], t: SourceCopy, locale: string): string {
    const usd = (value: number) => formatNumber(value, locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 3 })
    return t('sources.pricePerMillion', { input: usd(price.input), output: usd(price.output) })
}

export function moldwrightTierDescription(connectionId: string, model: string, t: SourceCopy): string | undefined {
    if (connectionId !== RERUN_CONNECTION_ID) return undefined
    const id = canonicalModelId(model)
    const tier = RERUN_TIERS.find(candidate => RERUN_MODELS[candidate] === id)
    const described = tier && RERUN_TIER_DESCRIPTION[tier]
    return described ? t(`sources.tiers.${described}`) : undefined
}

export function inTierOrder<T extends { id: string }>(connectionId: string, models: T[]): T[] {
    if (connectionId !== RERUN_CONNECTION_ID) return models
    const rank = (id: string) => {
        const at = RERUN_TIERS.findIndex(tier => RERUN_MODELS[tier] === id)
        return at === -1 ? RERUN_TIERS.length : at
    }
    return [...models].sort((a, b) => rank(a.id) - rank(b.id))
}

export function isCreditExhausted(source: BoxConnection, credit: MoldwrightCredit) {
    return source.id === RERUN_CONNECTION_ID && isCreditUsedUp(credit)
}

export function isMoldwrightPaused(source: BoxConnection, credit: MoldwrightCredit) {
    return source.id === RERUN_CONNECTION_ID && !!credit.paused
}

export function isUsable(source: BoxConnection, credit: MoldwrightCredit) {
    return source.connected && !source.credentialRejected && !isCreditExhausted(source, credit) && !isMoldwrightPaused(source, credit)
}

export function livePlanWindows(source: Pick<BoxConnection, 'planLimits'>, now = Date.now()): PlanLimitWindow[] {
    return (source.planLimits?.windows ?? []).map(window => (window.resetsAt && Date.parse(window.resetsAt) <= now ? { ...window, usedPercent: 0, resetsAt: null } : window))
}

export function tightestPlanWindow(windows: PlanLimitWindow[]): PlanLimitWindow | null {
    return windows.reduce<PlanLimitWindow | null>((tightest, window) => (!tightest || window.usedPercent > tightest.usedPercent ? window : tightest), null)
}

export type PillUsage = { inner: number; outer: number | null; windows: PlanLimitWindow[] }

export function pillUsage(group: { connectionId: string; planWindows: PlanLimitWindow[] }, credit: MoldwrightCredit): PillUsage | null {
    if (group.connectionId === RERUN_CONNECTION_ID) {
        if (credit.paused || credit.budgetMicros <= 0) return null
        return { inner: credit.percent, outer: null, windows: [] }
    }
    const session = group.planWindows.find(window => window.kind === 'session')
    const longest = tightestPlanWindow(group.planWindows.filter(window => window.kind !== 'session'))
    const inner = session ?? longest
    if (!inner) return null
    const outer = session ? longest : null
    return { inner: inner.usedPercent, outer: outer?.usedPercent ?? null, windows: outer ? [inner, outer] : [inner] }
}

export type PlanLimitTone = 'brand' | 'warning' | 'destructive'

export function planLimitTone(usedPercent: number): PlanLimitTone {
    if (usedPercent >= 90) return 'destructive'
    if (usedPercent >= 75) return 'warning'
    return 'brand'
}

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

function creditSummary(credit: MoldwrightCredit, t: SourceCopy, locale: string): string {
    if (credit.paused) return t('sources.creditPaused')
    if (!isCreditUsedUp(credit)) return t('sources.creditUsed', { percent: credit.percent })
    return credit.resetAt ? t('sources.creditUsedUpOn', { date: shortDate(credit.resetAt, locale) }) : t('sources.creditUsedUpNextMonth')
}

export function sourceSummary(source: BoxConnection, credit: MoldwrightCredit, t: SourceCopy, locale: string): string {
    if (source.id === RERUN_CONNECTION_ID) return creditSummary(credit, t, locale)
    const planWindows = livePlanWindows(source).filter(window => window.kind !== 'model')
    if (planWindows.length) return planWindows.map(window => t('sources.summaryWindow', { name: planWindowName(window, t, source.provider), percent: planWindowPercent(window) })).join(' · ')
    const kind = source.provider === 'custom' ? t('sources.pitch.custom.title') : t(`sources.kinds.${sourceKind(source.provider)}`)
    return t('sources.summary', { kind, count: enabledModels(source).length })
}

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
