import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
    formatCreditsLabel,
    isPaidDataCapability,
    isPaidDataGroup,
    PAID_DATA_CATALOG_TOOL,
    PAID_DATA_FULL_ANSWER_HEADER,
    PAID_DATA_GROUPS,
    PAID_DATA_OUT_OF_CREDIT,
    PAID_DATA_TOOL,
    paidDataCallSchema,
    paidDataCapabilityDoc,
    paidDataCatalogLookupSchema,
    paidDataEntry,
    paidDataGroupIndex,
    paidDataOverview,
    parsePaidDataParams,
    requestSpendSchema,
    type PaidDataCatalogLookup,
    type PaidDataEstimate,
    type RequestSpendInput,
    type SpendQuote,
} from '@rerun/contracts'
import { env } from '../../config/env.js'
import { deadlineSignal } from '../../lib/abort.js'
import { recordPaidSources } from '../../db/repos/paid-sources.js'
import { nowIso } from '../../lib/ids.js'
import { logger } from '../../lib/logger.js'
import { hubPriceMultiplier } from '../../paid-data/price.js'
import { paidCallVerdict } from '../../paid-data/sources.js'
import { outlineOf, PAID_ANSWERS_DIR, readPaidAnswer, savePaidAnswer, type FullPaidAnswer } from './paid-data-file.js'
import type { RunContext } from '../../runtime/context.js'
import { cardCallTiming } from '../../agents/turn-order.js'
import { hitlAck } from './hitl.js'
import { checkSpendConsent, recordSpend } from './spend-consent.js'
import { HOST_FAILURE_THRESHOLD, HostBreaker } from '../host-breaker.js'

// The hub waits up to 90 seconds on Treg, which walks several providers before it gives up.
const PAID_CALL_TIMEOUT_MS = 100_000
const ESTIMATE_TIMEOUT_MS = 15_000
// The 402 body the hub answers while a member keeps the credit paused (`RERUN_CREDIT_PAUSED_ERROR`).
const CREDIT_PAUSED_ERROR = 'rerun_credit_paused'
const MAX_RESULT_CHARS = 40_000
const PAID_DATA_READ_TOOL = 'paid_data_read'

// Both descriptions stay short on purpose: the Claude Code bridge truncates a tool description past
// 2,048 characters and OpenAI's chat API refuses one past 1,024, so the catalog is read through its
// own tool rather than listed here.
const PAID_DATA_DESCRIPTION = `Buy live data on the workspace's Rerun credit. Groups: people (prospects, work emails, phones, enrichment), companies (search, enrich, lookalikes, jobs, news), search (Google organic, Maps, local pack, News, Perplexity), seo (search volumes, keyword ideas, trends, backlinks, authority), linkedin (profiles, company pages, posts, comments, reactions), tiktok (profiles, videos, searches, comments), instagram (profiles, posts, reels, hashtags, comments), x (profiles, posts, searches, replies), youtube (channels, videos, searches, comments), facebook (pages, posts, comments), reddit (subreddit feeds, posts with comments). Pass a capability id and its params. Before the first call of a group in a task, read that group in ${PAID_DATA_CATALOG_TOOL}, free: it lists each capability id, its inputs and what it returns. Runs only once the user approved the spend. A call that finds nothing is often billed too: never repeat the same lookup.`

const PAID_DATA_CATALOG_DESCRIPTION = `Read the ${PAID_DATA_TOOL} catalog. Free, nothing is billed, no approval needed. Call it with a group before the first ${PAID_DATA_TOOL} call of that group in a task, and before request_spend, to plan the calls: one line per capability with its id, its inputs and what it returns. Call it with a capability id for its full input schema. With neither, it lists every group with its capability ids. Read it as soon as a task involves people, contacts, companies, social or SEO data, to plan the batch before you search the web.`

// The runtime checks stay beside the schema: a call through a CLI bridge can reach here unparsed.
async function readCatalog({ group, capability }: PaidDataCatalogLookup): Promise<string> {
    if (capability !== undefined) return isPaidDataCapability(capability) ? paidDataCapabilityDoc(capability, await hubPriceMultiplier()) : `Unknown capability "${capability}".\n\n${paidDataOverview()}`
    if (group !== undefined) return isPaidDataGroup(group) ? paidDataGroupIndex(group, await hubPriceMultiplier()) : `Unknown group "${group}": one of ${PAID_DATA_GROUPS.join(', ')}.`
    return paidDataOverview()
}

type HubAnswer = { status: number; body: Record<string, unknown> | null }

async function postHub(agentId: string, path: string, payload: unknown, timeout: AbortSignal, headers: Record<string, string> = {}): Promise<HubAnswer> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) throw new Error('paid data is unavailable: the engine is not linked to a Rerun hub')

    const res = await fetch(`${hub.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-rerun-agent': agentId, ...headers },
        body: JSON.stringify(payload),
        signal: timeout,
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

// The card the user decides on is priced by the hub, not by the model: a failed estimate throws, so
// no card goes out and the model reads why.
async function requestSpend(ctx: RunContext, input: RequestSpendInput): Promise<ReturnType<typeof hitlAck> & { quote: SpendQuote; priced: string }> {
    const unknown = input.calls.map(call => call.capability).find(capability => !isPaidDataCapability(capability))
    if (unknown !== undefined) throw new Error(`Unknown capability "${unknown}", nothing was asked: pick ids from ${PAID_DATA_CATALOG_TOOL}.`)
    const { status, body } = await postHub(ctx.agent.id, '/api/paid-data/estimate', { calls: input.calls }, AbortSignal.timeout(ESTIMATE_TIMEOUT_MS))
    if (status === 402 && body?.error === CREDIT_PAUSED_ERROR) throw new Error('Could not ask for this spend: the workspace Rerun credit is paused. Tell the user to resume it in Settings before asking again.')
    if (status !== 200 || !body) throw new Error(`Could not price this spend, nothing was asked: ${String(body?.error ?? `the Rerun hub answered ${status}`)}`)
    const estimate = body as unknown as PaidDataEstimate & { remainingMicros?: number }
    const creditLeftMicros = estimate.remainingMicros ?? 0
    return {
        ...hitlAck(ctx.turnOrder),
        quote: { totalMicros: estimate.totalMicros, lines: estimate.lines, creditLeftMicros },
        priced: `Priced at about ${formatCreditsLabel(estimate.totalMicros)}, ${formatCreditsLabel(creditLeftMicros)} left on the workspace. Quote these figures in credits, never the micros.`,
    }
}

type PaidCallStatus = 'found' | 'nothing_found' | 'pending' | 'failed' | 'not_run'

// Structured so the chat can add up what a run has spent and tell an empty credit apart without
// reading prose. `saved` is
// where the whole answer was kept. An answer that fits one tool result comes back whole in
// `result`; a bigger one comes back as the `outline` of the saved file, to read from there.
export type PaidCallOutput = { saved?: string; status: PaidCallStatus; reason?: typeof PAID_DATA_OUT_OF_CREDIT; billedMicros: number; message: string; servedBy?: string; result?: unknown; outline?: unknown }

type Shown = { note: string; result?: unknown; outline?: unknown }

function show(result: unknown, saved: string | undefined, full: FullPaidAnswer | null, missField: string): Shown {
    const text = JSON.stringify(result) ?? ''
    const readNote = saved ? ` The whole answer is saved at ${saved}: read any field with ${PAID_DATA_READ_TOOL}, free, or with jq / grep through shell_exec, and never buy it again.` : ''
    if (text.length <= MAX_RESULT_CHARS) return { note: readNote, result }
    if (!saved || !full) return { note: ' The answer could not be saved and is cut here: ask for fewer rows next time.', result: `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated]` }
    const { output, raw, notes } = full
    return {
        note: ` Too big to show here: saved whole at ${saved}. Read it with ${PAID_DATA_READ_TOOL} (path "output.${missField}", a page at a time) or with jq / grep through shell_exec, free, and never buy it again.`,
        outline: outlineOf({ notes, output, raw }),
    }
}

// What the hub says the provider did with the request, said in the message: buried in the result,
// a filter it dropped or the rows it sent past the limit go unread.
function providerNotes(result: unknown, saved: string | undefined, inResult: boolean): string {
    const { rows, ignoredFilters } = (result ?? {}) as { rows?: { asked?: unknown; returned?: unknown; total?: unknown }; ignoredFilters?: unknown }
    let notes = ''
    if (typeof rows?.asked === 'number' && typeof rows.returned === 'number') {
        const total = typeof rows.total === 'number' ? ` (${rows.total.toLocaleString('en-US')} match in all)` : ''
        const where = [inResult ? `the result shows the first ${rows.asked}` : null, saved ? `the saved file holds all ${rows.returned}` : null].filter(Boolean).join(', ')
        notes += ` The provider sent ${rows.returned} rows for the ${rows.asked} you asked for${total}${where ? `: ${where}` : ''}.`
    }
    const ignored = Array.isArray(ignoredFilters) ? ignoredFilters.filter((filter): filter is string => typeof filter === 'string') : []
    if (ignored.length) notes += ` The provider ignored these filters: ${ignored.join(', ')}. No row was filtered on them: check each row against them before you use it.`
    return notes
}

const notRun = (message: string): PaidCallOutput => ({ status: 'not_run', billedMicros: 0, message })

const SOURCE_DOWN_MESSAGE =
    'Not run, nothing was billed: this source is down for the moment. Go on with every part of the task that does not need it, then make this same call once more before you deliver: a call that fails this way is never billed. If it fails again, deliver the rest and say in one line which figures are missing.'

// Every capability goes through one provider: when it is down, a new lookup fails like the last one.
const PAID_DATA_BREAKER_KEY = 'paid_data'

const SOURCE_CLOSED_MESSAGE = `Not run, nothing was billed: paid data is closed for this run, the source was down ${HOST_FAILURE_THRESHOLD} times in a row. Do not call paid_data again in this run. Deliver what you already have and say in one line which figures are missing.`

const OUT_OF_CREDIT_MESSAGE =
    'Not run, nothing was billed: the workspace has no Rerun credit left. The app already shows the user how to add credit, so do not explain it: say in one line what you could not get, finish the task with your free tools, and do not call paid_data again in this run.'

// Best effort: the call is answered and billed whether or not its values could be indexed.
async function indexPaidCall(agentId: string, capability: string, params: unknown, callId: string, servedBy: string | undefined, result: unknown, full: FullPaidAnswer | null | undefined): Promise<void> {
    try {
        const output = full ? full.output : (result as { output?: unknown } | null | undefined)?.output
        await recordPaidSources(agentId, { callId, at: nowIso(), capability, servedBy: servedBy ?? null, output, ...paidCallVerdict(capability, params, result) })
    } catch (err) {
        logger.warn({ err: String(err), capability }, 'could not index a paid data call')
    }
}

async function runPaid(ctx: RunContext, breaker: HostBreaker, capability: string, rawParams: unknown, toolCallId: string): Promise<PaidCallOutput> {
    const parsed = parsePaidDataParams(capability, rawParams)
    if (!parsed.ok) return notRun(`Not run, nothing was billed: ${parsed.error}`)
    if (!breaker.check(PAID_DATA_BREAKER_KEY).open) return notRun(SOURCE_CLOSED_MESSAGE)

    const consent = await checkSpendConsent(ctx)
    if (!consent.granted) return notRun(consent.reason)

    let answer: HubAnswer
    try {
        answer = await postHub(ctx.agent.id, '/api/paid-data', { capability, params: parsed.params }, deadlineSignal(PAID_CALL_TIMEOUT_MS, ctx.abortSignal), { [PAID_DATA_FULL_ANSWER_HEADER]: '1' })
    } catch (e) {
        if (ctx.abortSignal?.aborted) throw e
        return { status: 'failed', billedMicros: 0, message: `Failed: ${(e as Error).message}. Nothing was billed.` }
    }

    const { status, body } = answer
    const sourceDown = status === 503
    const consecutiveDown = breaker.record(PAID_DATA_BREAKER_KEY, !sourceDown)
    const billedMicros = Number(body?.costMicros ?? 0) || 0
    recordSpend(consent.approvalId, billedMicros)
    const cost = billedMicros > 0 ? `Billed ${formatCreditsLabel(billedMicros)}.` : 'Nothing was billed.'

    if (status === 402) return { ...notRun(OUT_OF_CREDIT_MESSAGE), reason: PAID_DATA_OUT_OF_CREDIT }
    if (sourceDown) return notRun(consecutiveDown >= HOST_FAILURE_THRESHOLD ? SOURCE_CLOSED_MESSAGE : SOURCE_DOWN_MESSAGE)
    if (status !== 200 || !body) return { status: 'failed', billedMicros, message: `Failed: ${String(body?.error ?? `the Rerun hub answered ${status}`)}. ${cost}` }

    if (body.outcome === 'pending') return { status: 'pending', billedMicros, message: `The provider is still working on this request. ${cost} Do not call it again with the same input: it would be billed twice.` }
    const servedBy = typeof body.servedBy === 'string' ? body.servedBy : undefined
    const found = body.outcome !== 'miss'
    const full = found ? (body.full as FullPaidAnswer | null | undefined) : null
    const callId = typeof body.callId === 'string' ? body.callId : toolCallId
    const saved = full ? ((await savePaidAnswer(ctx.agent.id, { capability, params: parsed.params, callId, ...full })) ?? undefined) : undefined
    if (found) await indexPaidCall(ctx.agent.id, capability, parsed.params, toolCallId || callId, servedBy, body.result, full)
    const missField = isPaidDataCapability(capability) ? paidDataEntry(capability).missField : 'rows'
    const { note, ...shown } = found ? show(body.result, saved, full ?? null, missField) : { result: body.result, note: '' }
    return {
        ...(saved ? { saved } : {}),
        status: found ? 'found' : 'nothing_found',
        billedMicros,
        message: `${found ? 'Found.' : 'Nothing found.'} ${cost}${note}${found ? providerNotes(body.result, saved, 'result' in shown) : ''}`,
        ...(servedBy ? { servedBy } : {}),
        ...shown,
    }
}

const paidDataReadSchema = z.object({
    saved: z.string().min(1).describe(`The "saved" path a paid_data result gave, e.g. "${PAID_ANSWERS_DIR}/tiktok.video.detail-2026-10-15-abc.json".`),
    path: z.string().optional().describe('Dot path into the saved answer, e.g. "output.videos" or "raw.data.itemList.3.imagePost". Leave it out for an outline of its keys.'),
    offset: z.number().int().min(0).optional().describe('First item of a list, or first character of a text, to read.'),
    limit: z.number().int().min(1).optional().describe('How many items or characters to read at most.'),
})

const PAID_DATA_READ_DESCRIPTION = `Read back a paid_data answer saved in full, free: nothing is billed. Every paid_data answer is saved whole at its "saved" path (output, and the provider's raw body under raw); one too big for a result only shows its outline. Call it for the rows, a slide, a media URL or a nested field you need from there, before concluding anything is missing. Without a path it outlines the keys; a list reads a page at a time with offset.`

// request_spend only exists where someone can answer it: never once the user allowed paid data
// without asking, nor where approvals are off (a delegate, whose session nobody reads).
export function paidDataTools(ctx: RunContext): ToolSet {
    const tools: ToolSet = {}
    const breaker = ctx.hostBreaker ?? new HostBreaker()
    const config = ctx.agent.config
    if (config.tools.requestApproval && !config.paidDataAlwaysAllow) {
        tools.request_spend = tool({
            description: `Ask the user to approve spending Rerun credit on paid_data, and pause the run until they answer. Call it before the first paid call of a task, with every paid_data call the task needs, by capability: the Rerun hub prices them and the user sees one card with the cost per line and the total. Then end your turn. An approval covers about its estimate. One card per task is the normal way to use paid_data, not a last resort: call it as soon as you know the batch, including to offer the step that completes a result your free tools left partial. ${cardCallTiming(ctx.turnOrder)}`,
            inputSchema: requestSpendSchema,
            execute: async input => requestSpend(ctx, input),
        })
    }
    tools[PAID_DATA_CATALOG_TOOL] = tool({ description: PAID_DATA_CATALOG_DESCRIPTION, inputSchema: paidDataCatalogLookupSchema, execute: async input => readCatalog(input) })
    tools[PAID_DATA_TOOL] = tool({ description: PAID_DATA_DESCRIPTION, inputSchema: paidDataCallSchema, execute: async ({ capability, params }, { toolCallId }) => runPaid(ctx, breaker, capability, params, toolCallId) })
    tools[PAID_DATA_READ_TOOL] = tool({
        description: PAID_DATA_READ_DESCRIPTION,
        inputSchema: paidDataReadSchema,
        execute: async ({ saved, path, offset, limit }) => readPaidAnswer(ctx.agent.id, saved, path, offset, limit),
    })
    return tools
}
