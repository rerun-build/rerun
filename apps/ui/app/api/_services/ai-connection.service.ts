import 'server-only'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { assertModelEntitled } from '@/app/api/_services/engine-plan.service'
import { ensureWorkspaceEngine, findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { isPremiumModelEntitled } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import {
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
    isModelLocked,
    livePlanWindows,
    modelName,
    offeredModels,
    planWindowName,
    planWindowReset,
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
    createConnection as engineCreateConnection,
    deleteConnection as engineDeleteConnection,
    getConnectionUsage as engineGetConnectionUsage,
    probeCustomEndpoint as engineProbeCustomEndpoint,
    supportsCustomProvider,
    supportsOpencode,
    listConnections as engineListConnections,
    patchConnection as enginePatchConnection,
    setBoxDefault as engineSetBoxDefault,
    updateConnectionKeys as engineUpdateConnectionKeys,
} from '@/lib/engine/client'
import { type CodexDeviceAuthStart, codexKeysFrom, pollCodexDeviceAuth, startCodexDeviceAuth } from '@/lib/engine/codex-oauth'
import { pinFirst } from '@/lib/engine/model-groups'
import type { BoxConnection, BoxConnectionsList, BoxConnectionUsage, BoxDefault, CreateBoxConnectionInput, EngineConnection, UpdateBoxConnectionInput } from '@/lib/engine/types'
import { providerKeyProblem } from '@/lib/engine/verify-provider-key'
import { assertPublicUrl } from '@/lib/net/public-fetch'
import { OPENCODE_ENABLED } from '@/lib/features'
import { AppError, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { CONNECTION_TOKEN_KEY, DEFAULT_CONNECTION_MODELS, RERUN_CONNECTION_ID, canonicalModelId, canonicalModelIds, claudeTokenIssue, type AddableProvider, type AiConnectionView, type AiConnectionsView, type CustomProbeInput, type CustomProbeResult } from '@rerun/contracts'

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

// A workspace on a plan only claims its machine the first time something needs it, and plugging in
// a provider can be that first time.
async function connectionForCreate(workspaceId: number): Promise<EngineConnection> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (engine) return engine.conn
    const claimed = await ensureWorkspaceEngine(workspaceId)
    if (!claimed.ok) throw new Error(claimed.error)
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

export async function listAiConnections(workspaceId: number): Promise<BoxConnectionsList> {
    const conn = await getWorkspaceConnection(workspaceId)
    return renameAliasedModels(conn, await engineListConnections(conn))
}

export async function setWorkspaceDefaultModel(workspaceId: number, pick: BoxDefault | null): Promise<void> {
    await assertModelEntitled(pick?.model, workspaceId)
    await engineSetBoxDefault(await getWorkspaceConnection(workspaceId), pick)
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
// fail every run with it.
export async function isOpencodeOffered(conn: EngineConnection | null | undefined): Promise<boolean> {
    return OPENCODE_ENABLED && !!conn && (await supportsOpencode(conn))
}

export async function isOpencodeOfferedTo(workspaceId: number): Promise<boolean> {
    if (!OPENCODE_ENABLED) return false
    return isOpencodeOffered((await findWorkspaceEngine(workspaceId))?.conn)
}

// A custom endpoint is run by the engine's own loop too, and probed by it: an older engine would
// refuse the provider outright.
export async function isCustomOffered(conn: EngineConnection | null | undefined): Promise<boolean> {
    return !!conn && (await supportsCustomProvider(conn))
}

export async function isCustomOfferedTo(workspaceId: number): Promise<boolean> {
    return isCustomOffered((await findWorkspaceEngine(workspaceId))?.conn)
}


async function assertProviderOffered(provider: CreateBoxConnectionInput['provider'], conn: EngineConnection): Promise<void> {
    if (provider === 'custom' && !(await supportsCustomProvider(conn))) throw new ConnectionInputError('customNeedsUpdate')
    if (provider !== 'opencode') return
    if (!OPENCODE_ENABLED) throw new ConnectionInputError('opencodeNotAvailable')
    if (!(await supportsOpencode(conn))) throw new ConnectionInputError('opencodeNeedsUpdate')
}

// Throws NoPlanError (capacity.service) when the workspace has no plan: without one there is no machine to hold a
// credential, whatever the user pastes.
export async function createAiConnection(workspaceId: number, params: CreateBoxConnectionInput): Promise<BoxConnection> {
    assertValidClaudeToken(params.keys)
    await assertPublicBaseUrl(params.baseUrl)
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
    return enginePatchConnection(await getWorkspaceConnection(workspaceId), id, patch)
}

export async function updateAiConnectionKeys(workspaceId: number, id: string, body: { set?: Record<string, string>; remove?: string[] }): Promise<void> {
    assertValidClaudeToken(body.set)
    const conn = await getWorkspaceConnection(workspaceId)
    if (body.set && Object.keys(body.set).length > 0) {
        const target = (await engineListConnections(conn)).connections.find(c => c.id === id)
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

// --- The app's view ---

// What the app adds: the connection takes the name the web would suggest and the provider's
// default models, the way the web dialog creates one.
export async function addAiConnection(workspaceId: number, provider: AddableProvider, keys: Record<string, string>, options: { name?: string; baseUrl?: string; models?: string[] } = {}): Promise<string> {
    const name = options.name ?? suggestName(provider, await takenNames(workspaceId))
    const created = await createAiConnection(workspaceId, { name, provider, models: options.models ?? DEFAULT_CONNECTION_MODELS[provider], extraModels: [], baseUrl: options.baseUrl, keys })
    return created.id
}

// A sign-in that lands either adds a connection or puts an existing one back on its feet: the keys
// go straight to the machine, the caller only learns which connection holds them.
export async function storeSignInKeys(workspaceId: number, provider: AddableProvider, keys: Record<string, string>, target: { connectionId?: string; name?: string }): Promise<string> {
    if (!target.connectionId) return addAiConnection(workspaceId, provider, keys, { name: target.name })
    const existing = (await listAiConnections(workspaceId)).connections.find(connection => connection.id === target.connectionId)
    if (existing?.provider !== provider) throw new ConnectionInputError('signInOtherProvider')
    await updateAiConnectionKeys(workspaceId, existing.id, { set: keys })
    return existing.id
}

async function takenNames(workspaceId: number): Promise<string[]> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return []
    return (await engineListConnections(engine.conn)).connections.map(connection => connection.name)
}

function connectionView(source: BoxConnection, list: BoxConnectionsList, credit: RerunCredit, premiumAllowed: boolean, t: SourceCopy, locale: string): AiConnectionView {
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
        models: offeredModels(source).map(model => ({
            id: model.id,
            label: model.label,
            description: modelDescription(source, model.id, t),
            enabled: isModelEnabled(source, model.id),
            locked: isModelLocked(source.id, model.id, premiumAllowed),
        })),
        baseUrl: source.baseUrl ?? '',
        extraModels: source.extraModels,
        planWindows: livePlanWindows(source).map(window => ({ name: planWindowName(window, t, source.provider), usedPercent: window.usedPercent, reset: planWindowReset(window, t, locale) })),
    }
}

// The web dialog's list, with every rule it applies (catalog, hidden and locked models, plan
// windows, credit) applied here, since the app has none of them.
export async function readAiConnectionsView(ctx: WorkspaceContext): Promise<AiConnectionsView> {
    const engine = await findWorkspaceEngine(ctx.workspace.id)
    const list = engine ? await renameAliasedModels(engine.conn, await engineListConnections(engine.conn)) : { connections: [], default: null }
    const credit = rerunCreditOf(ctx.workspace)
    const premiumAllowed = isPremiumModelEntitled(ctx.workspace)
    const pick = effectiveDefault(list.default)
    const taken = list.connections.map(connection => connection.name)
    const locale = await recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id)
    const t = await translatorFor(locale, 'connections')
    return {
        connections: pinFirst(list.connections, connection => connection.id === RERUN_CONNECTION_ID).map(source => connectionView(source, list, credit, premiumAllowed, t, locale)),
        default: { ...pick, label: modelName(pick.connectionId, pick.model) },
        credit: { percent: credit.percent, usedUp: isCreditUsedUp(credit), backOn: creditResetPhrase(credit, t, locale) },
        addable: [...planProviders(await isOpencodeOffered(engine?.conn)), ...keyProviders(await isCustomOffered(engine?.conn))].map(provider => ({
            provider,
            kind: sourceKind(provider),
            ...providerPitch(provider, t),
            suggestedName: suggestName(provider, taken),
            guide: provider === 'opencode' || KEY_PROVIDERS.includes(provider as KeyProvider) ? providerGuide(provider as GuidedProvider, t) : null,
        })),
    }
}
