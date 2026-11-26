import 'server-only'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureWorkspaceEngine, findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { isClaudePlanOffered } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { getBrand } from '@/lib/brand/server'
import {
    brandConnection,
    brandConnections,
    KEY_PROVIDERS,
    keyProviders,
    planProviders,
    providerGuide,
    providerPitch,
    creditResetPhrase,
    effectiveDefault,
    isCreditExhausted,
    isCreditUsedUp,
    isModelEnabled,
    livePlanWindows,
    modelName,
    offeredModels,
    planWindowView,
    rerunCreditOf,
    modelDescription,
    sourceKind,
    sourceSummary,
    suggestName,
    type GuidedProvider,
    type KeyProvider,
    type RerunCredit,
    type SourceCopy,
} from '@/lib/engine/ai-sources'
import { type ClaudeOAuthStart, buildClaudeAuthorize, exchangeClaudeCode } from '@/lib/engine/claude-oauth'
import {
    EngineRequestError,
    createConnection as engineCreateConnection,
    deleteConnection as engineDeleteConnection,
    getConnectionUsage as engineGetConnectionUsage,
    probeCustomEndpoint as engineProbeCustomEndpoint,
    supportsCustomProvider,
    supportsGrok,
    supportsOpencode,
    listConnections as engineListConnections,
    patchConnection as enginePatchConnection,
    setBoxBackups as engineSetBoxBackups,
    setBoxDefault as engineSetBoxDefault,
    updateConnectionKeys as engineUpdateConnectionKeys,
} from '@/lib/engine/client'
import { type CodexDeviceAuthStart, codexKeysFrom, pollCodexDeviceAuth, startCodexDeviceAuth } from '@/lib/engine/codex-oauth'
import { type GrokDeviceAuthStart, grokKeysFrom, pollGrokDeviceAuth, revokeGrokKeys, startGrokDeviceAuth } from '@/lib/engine/grok-oauth'
import { pinFirst } from '@/lib/engine/model-groups'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { NoPlanError } from '@/app/api/_services/capacity.service'
import type { BoxBackupModels, BoxConnection, BoxConnectionsList, BoxConnectionUsage, BoxDefault, CreateBoxConnectionInput, EngineConnection, UpdateBoxConnectionInput } from '@/lib/engine/types'
import { providerKeyProblem } from '@/lib/engine/verify-provider-key'
import { assertPublicUrl } from '@/lib/net/public-fetch'
import { AppError, type ActionFailure, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { CONNECTION_SATELLITE_KEYS, CONNECTION_TOKEN_KEY, DEFAULT_CONNECTION_MODELS, NO_BOX_BACKUPS, RERUN_CONNECTION_ID, canonicalModelId, canonicalModelIds, claudeTokenIssue, type AddableProvider, type AiConnectionView, type AiConnectionsView, type CustomProbeInput, type CustomProbeResult } from '@rerun/contracts'

// The AI providers of a workspace, for both the web dialog's server actions and the app's /api/v1
// routes. They live at the root of the engine's data dir, never under a Box: the workspace is the
// whole scope.

// A credential the user handed in that cannot be stored: the message is for them, as is.
export class ConnectionInputError extends AppError {
    constructor(code: ErrorCode, params?: ErrorParams) {
        super(code, params)
        this.name = 'ConnectionInputError'
    }
}

// A workspace without a machine whose claim failed: the message stays the claim's own (no free machine,
// a restore under way, no server paired on a self-hosted install).
class MachineUnavailableError extends Error {
    constructor(readonly failure: ActionFailure) {
        super(failure.error)
        this.name = 'MachineUnavailableError'
    }
}

// A workspace on a plan only claims its machine the first time something needs it, and plugging in
// a provider can be that first time.
async function connectionForCreate(workspaceId: number): Promise<EngineConnection> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (engine) return engine.conn
    const claimed = await ensureWorkspaceEngine(workspaceId)
    if (!claimed.ok) throw new MachineUnavailableError(claimed)
    return getWorkspaceConnection(workspaceId)
}

// A box curated before Rerun Balanced became an alias still stores the OpenRouter id it used to be, and
// lists it next to its current name as a second row under the same label. The engine renames it on
// its next boot; doing it here too is what spares a fleet update, and the engine's own patch moves
// the box default off the old spelling at the same time.
function carriesAliasedModel(connection: BoxConnection): boolean {
    return [...connection.models, ...connection.extraModels].some(id => canonicalModelId(id) !== id)
}

async function renameAliasedModels(conn: EngineConnection, list: BoxConnectionsList): Promise<BoxConnectionsList> {
    const stale = list.connections.filter(carriesAliasedModel)
    if (stale.length === 0) return list
    try {
        for (const connection of stale) {
            await enginePatchConnection(conn, connection.id, { models: canonicalModelIds(connection.models), extraModels: canonicalModelIds(connection.extraModels) })
        }
        return await engineListConnections(conn)
    } catch {
        // A rename is cosmetic, and the read it rides on is not: a box that refuses the write still
        // has its providers to show, duplicate row and all.
        return list
    }
}

export async function listAiConnections(workspaceId: number, { fresh = false }: { fresh?: boolean } = {}): Promise<BoxConnectionsList> {
    const conn = await getWorkspaceConnection(workspaceId)
    const [brand, list] = await Promise.all([getBrand(), engineListConnections(conn, {}, { fresh })])
    return brandConnections(await renameAliasedModels(conn, list), brand)
}

export async function setWorkspaceDefaultModel(workspaceId: number, pick: BoxDefault | null): Promise<void> {
    await engineSetBoxDefault(await getWorkspaceConnection(workspaceId), pick)
}

export async function setWorkspaceBackupModels(workspaceId: number, next: BoxBackupModels): Promise<void> {
    await engineSetBoxBackups(await getWorkspaceConnection(workspaceId), next)
}

// The widget already refuses these; this is the guard for every other caller.
function assertValidClaudeToken(keys: Record<string, string> | undefined): void {
    const token = keys?.[CONNECTION_TOKEN_KEY.claude]
    const issue = token === undefined ? null : claudeTokenIssue(token)
    if (issue) throw new ConnectionInputError(issue)
}

// The machine sends the user's key to this address: on Rerun Cloud a private one would turn the Box
// into a probe of the host's own network. A self-hosted install runs on its owner's network, and the
// model it most often points at (Ollama, LM Studio) listens on that very machine.
async function assertPublicBaseUrl(baseUrl: string | undefined): Promise<void> {
    if (!baseUrl || !RERUN_CLOUD) return
    try {
        await assertPublicUrl(baseUrl)
    } catch {
        throw new ConnectionInputError('baseUrlNotPublic')
    }
}

// OpenCode runs inside the engine's own loop, so a machine on an older engine would store the key and
// fail every run with it. A workspace with no machine yet is offered it like any provider: plugging
// one in claims its machine, which runs the current engine.
export async function isOpencodeOffered(conn: EngineConnection | null | undefined): Promise<boolean> {
    return !conn || (await supportsOpencode(conn))
}

// A custom endpoint is run by the engine's own loop too, and probed by it: an older engine would
// refuse the provider outright. Offered without a machine yet, for the same reason as OpenCode.
export async function isCustomOffered(conn: EngineConnection | null | undefined): Promise<boolean> {
    return !conn || (await supportsCustomProvider(conn))
}

// Grok runs in the engine's own loop too, and only an engine that announces it keeps its tokens fresh.
// Offered without a machine yet, for the same reason as OpenCode.
export async function isGrokOffered(conn: EngineConnection | null | undefined): Promise<boolean> {
    return !conn || (await supportsGrok(conn))
}

// `opencodeOffered`: whether this workspace's engine runs OpenCode. `customOffered`: whether it runs
// custom endpoints. `grokOffered`: whether it runs a Grok plan.
export type AiConnectionsList = BoxConnectionsList & { opencodeOffered: boolean; customOffered: boolean; grokOffered: boolean }

// A workspace whose machine is not claimed yet has nothing plugged in, and is offered every provider.
export async function listAiConnectionsWithOffers(workspaceId: number, { fresh = false }: { fresh?: boolean } = {}): Promise<AiConnectionsList> {
    const engine = await findWorkspaceEngine(workspaceId)
    const [list, opencodeOffered, customOffered, grokOffered] = await Promise.all([
        engine ? listAiConnections(workspaceId, { fresh }) : { connections: [], default: null, backups: NO_BOX_BACKUPS },
        isOpencodeOffered(engine?.conn).catch(() => false),
        isCustomOffered(engine?.conn).catch(() => false),
        isGrokOffered(engine?.conn).catch(() => false),
    ])
    return { ...list, opencodeOffered, customOffered, grokOffered }
}


// The mobile app and the routes reach this without the web's list, so the rule is held here too.
async function assertClaudePlanOffered(workspaceId: number, provider: CreateBoxConnectionInput['provider']): Promise<void> {
    if (provider !== 'claude') return
    const { data: workspace } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['plan'] as const, { id: workspaceId })
    if (!isClaudePlanOffered(workspace)) throw new ConnectionInputError('claudePlanNotOffered')
}

async function assertProviderOffered(provider: CreateBoxConnectionInput['provider'], conn: EngineConnection): Promise<void> {
    if (provider === 'custom' && !(await supportsCustomProvider(conn))) throw new ConnectionInputError('customNeedsUpdate')
    if (provider === 'grok' && !(await supportsGrok(conn))) throw new ConnectionInputError('grokNeedsUpdate')
    if (provider !== 'opencode') return
    if (!(await supportsOpencode(conn))) throw new ConnectionInputError('opencodeNeedsUpdate')
}

// A Grok plan only arrives through its sign-in, which the hub finishes itself: a value pasted by hand
// would be a token the engine cannot refresh, or one taken from someone else's machine.
function assertNotPastedGrok(provider: CreateBoxConnectionInput['provider'], { signedIn }: SignInOrigin): void {
    if (provider === 'grok' && !signedIn) throw new ConnectionInputError('grokSignInOnly')
}

type SignInOrigin = { signedIn?: boolean }

// Throws NoPlanError (capacity.service) when the workspace has no plan: without one there is no machine to hold a
// credential, whatever the user pastes.
export async function createAiConnection(workspaceId: number, params: CreateBoxConnectionInput, origin: SignInOrigin = {}): Promise<BoxConnection> {
    assertNotPastedGrok(params.provider, origin)
    assertValidClaudeToken(params.keys)
    await assertPublicBaseUrl(params.baseUrl)
    await assertClaudePlanOffered(workspaceId, params.provider)
    const conn = await connectionForCreate(workspaceId)
    await assertProviderOffered(params.provider, conn)
    const keyProblem = await providerKeyProblem(params.provider, params.keys, params.baseUrl)
    if (keyProblem) throw new ConnectionInputError(keyProblem.code, keyProblem.params)
    return engineCreateConnection(conn, params)
}

// Asked of the machine, which is what will call the endpoint: on a self-hosted install it sits on a
// network the hub may not see.
export async function probeCustomEndpoint(workspaceId: number, input: CustomProbeInput): Promise<CustomProbeResult> {
    await assertPublicBaseUrl(input.baseUrl)
    const conn = await connectionForCreate(workspaceId)
    if (!(await supportsCustomProvider(conn))) throw new ConnectionInputError('customNeedsUpdate')
    return engineProbeCustomEndpoint(conn, input)
}

export async function updateAiConnection(workspaceId: number, id: string, patch: UpdateBoxConnectionInput): Promise<BoxConnection> {
    await assertPublicBaseUrl(patch.baseUrl)
    return brandConnection(await enginePatchConnection(await getWorkspaceConnection(workspaceId), id, patch), await getBrand())
}

export async function updateAiConnectionKeys(workspaceId: number, id: string, body: { set?: Record<string, string>; remove?: string[] }, origin: SignInOrigin = {}): Promise<void> {
    assertValidClaudeToken(body.set)
    const conn = await getWorkspaceConnection(workspaceId)
    if (body.set && Object.keys(body.set).length > 0) {
        const target = (await engineListConnections(conn)).connections.find(c => c.id === id)
        if (target) assertNotPastedGrok(target.provider, origin)
        const keyProblem = target ? await providerKeyProblem(target.provider, body.set, target.baseUrl) : null
        if (keyProblem) throw new ConnectionInputError(keyProblem.code, keyProblem.params)
    }
    await engineUpdateConnectionKeys(conn, id, body)
}

export async function getAiConnectionUsage(workspaceId: number, id: string): Promise<BoxConnectionUsage> {
    return engineGetConnectionUsage(await getWorkspaceConnection(workspaceId), id)
}

// The delete always goes through: whatever pointed at the connection is released onto the default
// first, and what comes back is what moved.
export async function deleteAiConnection(workspaceId: number, id: string): Promise<BoxConnectionUsage> {
    return engineDeleteConnection(await getWorkspaceConnection(workspaceId), id)
}

// --- Claude (Subscription) OAuth ---
// One-click alternative to running `claude setup-token`: the user authorizes and pastes back the
// short code Anthropic shows, and the exchange runs server side (CORS-blocked in the browser).

export function startClaudeSignIn(): ClaudeOAuthStart {
    return buildClaudeAuthorize()
}

export async function claudeKeysFromCode(code: string, verifier: string, state: string): Promise<Record<string, string>> {
    const { accessToken, refreshToken, expiresAt } = await exchangeClaudeCode(code, verifier, state)
    const keys: Record<string, string> = { CLAUDE_CODE_OAUTH_TOKEN: accessToken }
    // Without the refresh material the engine cannot keep the token fresh, and the user is
    // back here every day. A setup-token pasted by hand legitimately has none.
    if (refreshToken) keys.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = refreshToken
    if (expiresAt !== undefined) keys.CLAUDE_CODE_OAUTH_EXPIRES_AT = String(expiresAt)
    return keys
}

// --- Codex (Subscription) device auth ---
// Codex's browser login cannot be reproduced from a web app (its redirect_uri is a hardcoded
// localhost listener), so the user gets a short code to type on OpenAI's own page while we poll.

export function startCodexSignIn(): Promise<CodexDeviceAuthStart> {
    return startCodexDeviceAuth()
}

// Null while the user has not approved yet.
export async function codexKeysWhenApproved(deviceAuthId: string, userCode: string): Promise<Record<string, string> | null> {
    const tokens = await pollCodexDeviceAuth(deviceAuthId, userCode)
    return tokens ? codexKeysFrom(tokens) : null
}

// --- Grok (Subscription) device auth ---
// The person types a code on xAI's page; the hub polls and, once approved, stores the connection
// itself: neither the device code nor a token ever reaches the browser or the phone.

export async function startGrokSignIn(workspaceId: number): Promise<GrokDeviceAuthStart> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!(await isGrokOffered(engine?.conn))) throw new ConnectionInputError('grokNeedsUpdate')
    return startGrokDeviceAuth()
}

type GrokSignInWait = { status: 'pending'; slowDown?: true }

// The keys once the person has approved, which the caller stores at once (`storeGrokSignIn`) and never
// hands further. Until then, the answer its poll gets.
export async function grokKeysWhenApproved(deviceCode: string): Promise<{ keys: Record<string, string> } | GrokSignInWait> {
    const answer = await pollGrokDeviceAuth(deviceCode)
    if (answer === 'pending') return { status: 'pending' }
    if (answer === 'slow_down') return { status: 'pending', slowDown: true }
    return { keys: grokKeysFrom(answer) }
}

type GrokSignInTarget = { connectionId?: string; name?: string }

// The hub's own refusals and the engine's 4xx come before anything is written. Any other failure (a
// timeout, a 5xx, a machine out of reach, an answer that does not parse) may come after: the engine
// writes the keys first, then reads the account's models before it answers.
function refusedBeforeStoring(err: unknown): boolean {
    return err instanceof NoPlanError || err instanceof ConnectionInputError || (err instanceof EngineRequestError && err.status >= 400 && err.status < 500)
}

async function grokConnectionIds(workspaceId: number): Promise<Set<string>> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return new Set()
    const { connections } = await engineListConnections(engine.conn)
    return new Set(connections.filter(connection => connection.provider === 'grok').map(connection => connection.id))
}

type GrokStoreOutcome = { storedOn: string } | 'not-stored' | 'unknown'

// What the machine holds after a store that failed without saying where. A new connection is written
// the moment the request lands, so a list without it says nothing was stored. Keys sent to an existing
// connection can still be waiting behind a refresh: only the connection back on its feet is an answer.
async function grokStoreOutcome(workspaceId: number, target: GrokSignInTarget, before: Set<string> | null): Promise<GrokStoreOutcome> {
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine) return 'not-stored'
        const grok = (await engineListConnections(engine.conn)).connections.filter(connection => connection.provider === 'grok')
        if (target.connectionId) {
            const signedInAgain = grok.find(connection => connection.id === target.connectionId && connection.connected && !connection.credentialRejected)
            return signedInAgain ? { storedOn: signedInAgain.id } : 'unknown'
        }
        if (!before) return 'unknown'
        const added = grok.find(connection => !before.has(connection.id))
        return added ? { storedOn: added.id } : 'not-stored'
    } catch {
        return 'unknown'
    }
}

// xAI has spent the device code by now: a store that fails cannot be polled again into a success. A
// sign-in the machine did not take is handed back to xAI and the refusal says to start again, unless
// it already says why (no plan, another provider). One the machine did take is a success, whatever
// its answer became on the way back. Tokens are never revoked while the machine may hold them: a
// connection signed out under the coworkers it runs is worse than a sign-in nobody holds.
export async function storeGrokSignIn(workspaceId: number, keys: Record<string, string>, target: GrokSignInTarget): Promise<string> {
    const before = target.connectionId ? null : await grokConnectionIds(workspaceId).catch(() => null)
    try {
        return await storeSignInKeys(workspaceId, 'grok', keys, target)
    } catch (err) {
        if (err instanceof MachineUnavailableError) {
            await revokeGrokKeys(keys)
            throw new ConnectionInputError(err.failure.code ?? 'noMachine', err.failure.params)
        }
        const outcome = refusedBeforeStoring(err) ? 'not-stored' : await grokStoreOutcome(workspaceId, target, before)
        if (typeof outcome === 'object') return outcome.storedOn
        if (outcome === 'not-stored') await revokeGrokKeys(keys)
        if (err instanceof NoPlanError || err instanceof ConnectionInputError) throw err
        throw new ConnectionInputError('grokSignInNotStored')
    }
}

// --- The app's view ---

// What the app adds: the connection takes the name the web would suggest and the provider's
// default models, the way the web dialog creates one.
export async function addAiConnection(workspaceId: number, provider: AddableProvider, keys: Record<string, string>, options: { name?: string; baseUrl?: string; models?: string[] } & SignInOrigin = {}): Promise<string> {
    const name = options.name ?? suggestName(provider, await takenNames(workspaceId))
    const created = await createAiConnection(workspaceId, { name, provider, models: options.models ?? DEFAULT_CONNECTION_MODELS[provider], extraModels: [], baseUrl: options.baseUrl, keys }, { signedIn: options.signedIn })
    return created.id
}

// A sign-in that lands either adds a connection or puts an existing one back on its feet: the keys
// go straight to the machine, the caller only learns which connection holds them.
export async function storeSignInKeys(workspaceId: number, provider: AddableProvider, keys: Record<string, string>, target: { connectionId?: string; name?: string }): Promise<string> {
    if (!target.connectionId) return addAiConnection(workspaceId, provider, keys, { name: target.name, signedIn: true })
    const existing = (await listAiConnections(workspaceId)).connections.find(connection => connection.id === target.connectionId)
    if (existing?.provider !== provider) throw new ConnectionInputError('signInOtherProvider')
    // A new Grok sign-in may be another account: what the old one left and the new one does not carry
    // goes, so the engine never refreshes against the previous lineage.
    const remove = provider === 'grok' ? CONNECTION_SATELLITE_KEYS.grok.filter(key => !(key in keys)) : undefined
    await updateAiConnectionKeys(workspaceId, existing.id, { set: keys, ...(remove ? { remove } : {}) }, { signedIn: true })
    return existing.id
}

async function takenNames(workspaceId: number): Promise<string[]> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return []
    return (await engineListConnections(engine.conn)).connections.map(connection => connection.name)
}

function connectionView(source: BoxConnection, list: BoxConnectionsList, credit: RerunCredit, t: SourceCopy, locale: string, brandName: string): AiConnectionView {
    const status = !source.connected || source.credentialRejected ? 'reconnect' : isCreditExhausted(source, credit) ? 'credit_used_up' : 'connected'
    return {
        id: source.id,
        name: source.name,
        provider: source.provider,
        kind: sourceKind(source.provider),
        status,
        credentialOnFile: source.connected,
        summary: sourceSummary(source, credit, t, locale),
        isDefault: effectiveDefault(list.default).connectionId === source.id,
        models: offeredModels(source, brandName).map(model => ({
            id: model.id,
            label: model.label,
            description: modelDescription(source, model.id, t),
            enabled: isModelEnabled(source, model.id),
            // Always false: the app builds already in the stores still require the field.
            locked: false,
        })),
        baseUrl: source.baseUrl ?? '',
        extraModels: source.extraModels,
        planWindows: livePlanWindows(source).map(window => planWindowView(window, t, source.provider, locale)),
    }
}

// The web dialog's list, with every rule it applies (catalog, hidden models, plan
// windows, credit) applied here, since the app has none of them.
export async function readAiConnectionsView(ctx: WorkspaceContext): Promise<AiConnectionsView> {
    const engine = await findWorkspaceEngine(ctx.workspace.id)
    const brand = await getBrand()
    const list = engine ? brandConnections(await renameAliasedModels(engine.conn, await engineListConnections(engine.conn)), brand) : { connections: [], default: null, backups: NO_BOX_BACKUPS }
    const credit = rerunCreditOf(ctx.workspace)
    const pick = effectiveDefault(list.default)
    const taken = list.connections.map(connection => connection.name)
    const locale = await recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id)
    const t = await translatorFor(locale, 'connections', brand.name)
    return {
        connections: pinFirst(list.connections, connection => connection.id === RERUN_CONNECTION_ID).map(source => connectionView(source, list, credit, t, locale, brand.name)),
        default: { ...pick, label: modelName(pick.connectionId, pick.model, brand.name) },
        credit: { percent: credit.percent, usedUp: isCreditUsedUp(credit), backOn: creditResetPhrase(credit, t, locale) },
        addable: [...planProviders(await isOpencodeOffered(engine?.conn), { claude: isClaudePlanOffered(ctx.workspace), grok: await isGrokOffered(engine?.conn) }), ...keyProviders(await isCustomOffered(engine?.conn))].map(provider => ({
            provider,
            kind: sourceKind(provider),
            ...providerPitch(provider, t),
            suggestedName: suggestName(provider, taken),
            guide: provider === 'opencode' || KEY_PROVIDERS.includes(provider as KeyProvider) ? providerGuide(provider as GuidedProvider, t) : null,
        })),
    }
}
