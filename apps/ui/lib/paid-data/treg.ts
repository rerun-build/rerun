import { paidDataEntry, paidDataRouteMaxCostUsd, type PaidDataCapability } from '@rerun/contracts'

const TREG_BASE_URL = 'https://treg.to'
// A routed call walks its providers one after the other and polls an async one for up to 60
// seconds before answering 202, so it needs well over a plain API call.
const TIMEOUT_MS = 90_000

export type TregOutcome = 'ok' | 'miss' | 'pending' | 'error'

export type TregCall = {
    // Null when Treg could not be reached at all.
    status: number | null
    outcome: TregOutcome
    costMicros: number
    servedBy: string | null
    callId: string | null
    // `output` as Treg gave it, plus the notes Treg adds for the caller (verification, advice, ignored
    // filters). The provider's raw answer is left out: it repeats `output` at several times the size.
    result: unknown
    // The answer as Treg gave it, when asked for: the engine saves it so nothing paid is ever lost.
    full: TregFullAnswer | null
    error: string | null
    // Treg's machine-readable reason, e.g. `route_max_cost`.
    errorCode: string | null
}

export type TregFullAnswer = { output: unknown; raw: unknown; notes: TregNotes }

type TregBody = { output?: Record<string, unknown>; raw?: unknown; error?: unknown; detail?: unknown; message?: unknown; _treg?: Record<string, unknown> }
type TregNotes = { servedBy?: unknown; verification?: unknown; advice?: unknown; ignoredFilters?: unknown }
type TregDetail = { error?: unknown; message?: unknown }

function isEmpty(value: unknown): boolean {
    return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

function outcomeOf(capability: PaidDataCapability, body: TregBody, status: number): TregOutcome {
    if (status === 202) return 'pending'
    return isEmpty(body.output?.[paidDataEntry(capability).missField]) ? 'miss' : 'ok'
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

// Treg answers its own errors either flat or under `detail`, a string or an object.
function errorOf(body: TregBody | null, status: number): { error: string; errorCode: string | null } {
    const detail = (body?.detail && typeof body.detail === 'object' ? body.detail : {}) as TregDetail
    const errorCode = asText(body?.error) ?? asText(detail.error)
    return { error: asText(detail.message) ?? asText(body?.message) ?? asText(body?.detail) ?? errorCode ?? `Treg answered ${status}`, errorCode }
}

// What Treg paid its providers stays out of anything the coworker or the user reads: they are billed
// in credits, at a price of our own.
function withoutCost(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(cost|charge|price)/i.test(key)))
}

// A provider's raw answer can carry its own bill too (`cost`, `creditsCharged`, `credits_remaining`),
// at any depth. A key is read word by word: it goes when every word is about billing, and stays as
// soon as one word is data, so `Credit cards`, `billing_address` or `cost_of_living` are kept.
const BILLING_WORDS = new Set(['cost', 'costs', 'credit', 'credits', 'charge', 'charged', 'charges', 'billing', 'billed', 'quota'])
const BILLING_MODIFIERS = new Set(['remaining', 'used', 'consumed', 'job', 'info', 'micros', 'total', 'amount', 'per', 'call', 'request', 'unit', 'currency', 'usd', 'balance', 'left'])

const wordsOf = (key: string): string[] =>
    key
        .split(/[^a-zA-Z0-9]+/)
        .flatMap(part => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
        .filter(Boolean)
        .map(word => word.toLowerCase())

function isBillingKey(key: string): boolean {
    const words = wordsOf(key)
    return words.some(word => BILLING_WORDS.has(word)) && words.every(word => BILLING_WORDS.has(word) || BILLING_MODIFIERS.has(word))
}

function withoutBilling(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutBilling)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !isBillingKey(key)).map(([key, child]) => [key, withoutBilling(child)]))
}

function notesOf(body: TregBody): TregNotes {
    const notes = body._treg ?? {}
    return { servedBy: notes.served_by, verification: withoutCost(notes.verification), advice: notes.advice, ignoredFilters: notes.ignored_filters }
}

function askedRows(capability: PaidDataCapability, params: Record<string, unknown>): number | undefined {
    return paidDataEntry(capability).unit === 'row' && typeof params.limit === 'number' ? params.limit : undefined
}

type TregRowsNote = { asked: number; returned: number; total?: number }

type Shown = { output: Record<string, unknown> | null; rows?: TregRowsNote; omittedFields?: string[] }

// Each row cut down to the fields the catalog shows, with the names of those it left in the full answer.
function withShownFields(list: unknown[], fields: readonly string[]): { list: unknown[]; omittedFields: string[] } {
    const omitted = new Set<string>()
    const shown = list.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row
        for (const key of Object.keys(row)) if (!fields.includes(key)) omitted.add(key)
        return Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)))
    })
    return { list: shown, omittedFields: [...omitted] }
}

// A provider that ignores `limit` answers with its own page size: a caller that takes the full
// answer sees the rows it asked for and is told about the rest, which stays in that full answer. A
// caller that does not gets every row it was billed for, every field of them too.
function shownOutput(capability: PaidDataCapability, output: Record<string, unknown> | undefined, asked: number | undefined, full: boolean): Shown {
    const { missField: field, shownFields } = paidDataEntry(capability)
    const list = output?.[field]
    if (!output || !Array.isArray(list)) return { output: output ?? null }
    const cut = asked !== undefined && list.length > asked
    const kept = cut ? list.slice(0, asked) : list
    const total = output.count
    const rows = cut ? { asked, returned: list.length, ...(typeof total === 'number' ? { total } : {}) } : undefined
    if (!full || !shownFields) return cut ? { output: { ...output, [field]: kept }, rows } : { output }
    const shown = withShownFields(kept, shownFields)
    return { output: { ...output, [field]: shown.list }, ...(rows ? { rows } : {}), ...(shown.omittedFields.length ? { omittedFields: shown.omittedFields } : {}) }
}

function resultOf(capability: PaidDataCapability, body: TregBody, asked: number | undefined, full: boolean): unknown {
    const { verification, advice, ignoredFilters } = notesOf(body)
    const { output, rows, omittedFields } = shownOutput(capability, body.output, asked, full)
    return { output, verification, advice, ignoredFilters, ...(rows ? { rows } : {}), ...(omittedFields ? { omittedFields } : {}) }
}

// Returns null when no token is configured: the caller has nothing to call Treg with.
export async function callTregCapability(
    capability: PaidDataCapability,
    params: Record<string, unknown>,
    tags: { workspaceId: number; agentId: string | null },
    options: { full?: boolean } = {},
): Promise<TregCall | null> {
    const token = process.env.TREG_API_TOKEN
    if (!token) return null

    // Set here and never by the model: it is what lets Treg's usage be reconciled per workspace.
    const meta = [`customer=ws_${tags.workspaceId}`, tags.agentId ? `agent=${tags.agentId.replace(/[^\w-]/g, '_')}` : null].filter(Boolean).join(', ')

    try {
        // The ceiling bounds the whole provider waterfall: a provider past it is refused unbilled.
        const routeHeaders: Readonly<Record<string, string>> = paidDataEntry(capability).routeHeaders ?? {}
        const asked = options.full ? askedRows(capability, params) : undefined
        const res = await fetch(`${TREG_BASE_URL}/call/treg.${capability}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Treg-Token': token, 'X-Treg-Meta': meta, 'X-Treg-Route-Max-Cost': paidDataRouteMaxCostUsd(capability, params).toFixed(4), ...routeHeaders },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const body = (await res.json().catch(() => null)) as TregBody | null
        const costMicros = Number(res.headers.get('x-treg-cost-micro') ?? 0) || 0
        const servedBy = res.headers.get('x-treg-served-by') ?? (typeof body?._treg?.served_by === 'string' ? body._treg.served_by : null)
        const callId = res.headers.get('x-treg-call-id')

        if (!res.ok || !body) return { status: res.status, outcome: 'error', costMicros, servedBy, callId, result: null, full: null, ...errorOf(body, res.status) }
        const full = options.full && body.output ? { output: body.output, raw: withoutBilling(body.raw ?? null), notes: notesOf(body) } : null
        return { status: res.status, outcome: outcomeOf(capability, body, res.status), costMicros, servedBy, callId, result: resultOf(capability, body, asked, !!full), full, error: null, errorCode: null }
    } catch (err) {
        return { status: null, outcome: 'error', costMicros: 0, servedBy: null, callId: null, result: null, full: null, error: err instanceof Error ? err.message : 'Treg could not be reached', errorCode: null }
    }
}
