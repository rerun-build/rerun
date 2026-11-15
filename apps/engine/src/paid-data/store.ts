import type { Client, InStatement } from '@libsql/client'
import type { TableSourceCall, TableSourceCell, TableSourcesRequest, TableSourcesResult } from '@rerun/contracts'
import { cellKeys, emailKey, equalityKeys, extractPaidItems, isWeakKey, isWebField, paidItemKeys, toHref, webKeys, type PaidItem, type PaidScalar } from './sources.js'

export type PaidSourceRecord = {
    callId: string
    at: string
    capability: string
    servedBy: string | null
    output: unknown
    verdict?: string | null
    verifiedEmail?: string | null
}

const IN_BATCH = 500
const MAX_LOOKUP_KEYS = 2_000

export async function writePaidSources(client: Client, record: PaidSourceRecord): Promise<void> {
    const items = extractPaidItems(record.output)
    const verifiedKey = record.verifiedEmail ? emailKey(record.verifiedEmail) : null
    if (verifiedKey && record.verifiedEmail && !items.some(item => paidItemKeys(item).some(({ key }) => key === verifiedKey))) {
        items.push({ fields: { email: record.verifiedEmail.trim(), ...(record.verdict ? { status: record.verdict } : {}) } })
    }
    if (!items.length) return

    const statements: InStatement[] = [{ sql: 'INSERT OR IGNORE INTO paid_calls (call_id, at, capability, served_by) VALUES (?, ?, ?, ?)', args: [record.callId, record.at, record.capability, record.servedBy] }]
    items.forEach((item, index) => {
        statements.push({ sql: 'INSERT OR IGNORE INTO paid_items (call_id, item, fields_json) VALUES (?, ?, ?)', args: [record.callId, index, JSON.stringify(item)] })
        for (const { key, field } of paidItemKeys(item)) {
            const verdictApplies = record.verdict && key.startsWith('e:') && (!verifiedKey || key === verifiedKey)
            statements.push({
                sql: 'INSERT OR IGNORE INTO paid_keys (key, call_id, item, field, verdict) VALUES (?, ?, ?, ?, ?)',
                args: [key, record.callId, index, field, verdictApplies ? record.verdict! : null],
            })
        }
    })
    await client.batch(statements, 'write')
}

type KeyHit = { key: string; callId: string; item: number; field: string; verdict: string | null }
type CallRow = TableSourceCall & { callId: string }

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')
const itemId = (callId: string, item: number) => `${callId}#${item}`

async function readHits(client: Client, keys: string[]): Promise<KeyHit[]> {
    const hits: KeyHit[] = []
    for (const batch of chunks(keys, IN_BATCH)) {
        const rs = await client.execute({ sql: `SELECT key, call_id, item, field, verdict FROM paid_keys WHERE key IN (${placeholders(batch.length)})`, args: batch })
        for (const row of rs.rows) hits.push({ key: String(row.key), callId: String(row.call_id), item: Number(row.item), field: String(row.field), verdict: row.verdict === null ? null : String(row.verdict) })
    }
    return hits
}

async function readCalls(client: Client, callIds: string[]): Promise<CallRow[]> {
    const calls: CallRow[] = []
    for (const batch of chunks(callIds, IN_BATCH)) {
        const rs = await client.execute({ sql: `SELECT call_id, at, capability, served_by FROM paid_calls WHERE call_id IN (${placeholders(batch.length)})`, args: batch })
        for (const row of rs.rows) calls.push({ callId: String(row.call_id), at: String(row.at), capability: String(row.capability), servedBy: row.served_by === null ? null : String(row.served_by) })
    }
    return calls
}

async function readItems(client: Client, ids: { callId: string; item: number }[]): Promise<Map<string, PaidItem>> {
    const items = new Map<string, PaidItem>()
    for (const batch of chunks(ids, IN_BATCH / 2)) {
        const rs = await client.execute({
            sql: `SELECT call_id, item, fields_json FROM paid_items WHERE (call_id, item) IN (VALUES ${batch.map(() => '(?, ?)').join(', ')})`,
            args: batch.flatMap(({ callId, item }) => [callId, item]),
        })
        for (const row of rs.rows) {
            try {
                items.set(itemId(String(row.call_id), Number(row.item)), JSON.parse(String(row.fields_json)) as PaidItem)
            } catch {}
        }
    }
    return items
}

type Cell = { column: string; value: PaidScalar | null; strong: string[]; weak: string | null }
type Anchor = { callId: string; item: number; at: string }

function hrefFor(item: PaidItem, field: string): string | undefined {
    const value = item.fields[field]
    if (typeof value === 'string' && isWebField(field) && webKeys(value).length) return toHref(value)
    return item.href
}

export async function readPaidSources(clients: Client[], rows: TableSourcesRequest['rows']): Promise<TableSourcesResult> {
    const rowCells: Cell[][] = rows.map(row => Object.entries(row).map(([column, value]) => ({ column, value, ...cellKeys(column, value) })))
    const keys = [...new Set(rowCells.flatMap(cells => cells.flatMap(cell => (cell.weak ? [...cell.strong, cell.weak] : cell.strong))))].slice(0, MAX_LOOKUP_KEYS)
    const empty: TableSourcesResult = { calls: {}, rows: rows.map(() => ({ sources: [], cells: {} })) }
    if (!keys.length || !clients.length) return empty

    const hitsByKey = new Map<string, KeyHit[]>()
    const calls = new Map<string, CallRow>()
    const clientOfCall = new Map<string, Client>()
    for (const client of clients) {
        const hits = await readHits(client, keys)
        for (const hit of hits) hitsByKey.set(hit.key, [...(hitsByKey.get(hit.key) ?? []), hit])
        const callIds = [...new Set(hits.map(hit => hit.callId))]
        for (const call of await readCalls(client, callIds)) {
            if (calls.has(call.callId)) continue
            calls.set(call.callId, call)
            clientOfCall.set(call.callId, client)
        }
    }
    if (!hitsByKey.size) return empty

    const atOf = (callId: string) => calls.get(callId)?.at ?? ''
    const anchorsByRow = rowCells.map(cells => {
        const strength = new Map<string, { anchor: Anchor; strong: boolean; weak: Set<string> }>()
        for (const cell of cells) {
            for (const key of cell.weak ? [...cell.strong, cell.weak] : cell.strong) {
                for (const hit of hitsByKey.get(key) ?? []) {
                    if (!calls.has(hit.callId)) continue
                    const id = itemId(hit.callId, hit.item)
                    const entry = strength.get(id) ?? { anchor: { callId: hit.callId, item: hit.item, at: atOf(hit.callId) }, strong: false, weak: new Set<string>() }
                    if (isWeakKey(key)) entry.weak.add(key)
                    else entry.strong = true
                    strength.set(id, entry)
                }
            }
        }
        return [...strength.values()]
            .filter(entry => entry.strong || entry.weak.size >= 2)
            .map(entry => entry.anchor)
            .sort((a, b) => (a.at === b.at ? a.item - b.item : a.at < b.at ? 1 : -1))
    })

    const items = new Map<string, PaidItem>()
    const anchored = new Map<string, Anchor>()
    for (const anchor of anchorsByRow.flat()) anchored.set(itemId(anchor.callId, anchor.item), anchor)
    for (const client of clients) {
        const own = [...anchored.values()].filter(anchor => clientOfCall.get(anchor.callId) === client)
        for (const [id, item] of await readItems(client, own)) items.set(id, item)
    }

    const fieldKeysCache = new Map<string, [string, Set<string>][]>()
    const fieldKeysOf = (id: string, item: PaidItem) => {
        const cached = fieldKeysCache.get(id)
        if (cached) return cached
        const computed = Object.entries(item.fields).map(([field, value]): [string, Set<string>] => [field, new Set(equalityKeys(field, value))])
        fieldKeysCache.set(id, computed)
        return computed
    }

    const latestVerdict = (key: string): string | undefined => {
        let best: { verdict: string; at: string } | undefined
        for (const hit of hitsByKey.get(key) ?? []) {
            if (!hit.verdict || !calls.has(hit.callId)) continue
            const at = atOf(hit.callId)
            if (!best || at > best.at) best = { verdict: hit.verdict, at }
        }
        return best?.verdict
    }

    const usedCalls = new Set<string>()
    const resultRows = rowCells.map((cells, index) => {
        const anchors = anchorsByRow[index]
        const sources = [...new Set(anchors.map(anchor => anchor.callId))]
        sources.forEach(callId => usedCalls.add(callId))
        const traced: Record<string, TableSourceCell> = {}
        for (const cell of cells) {
            const cellEquality = equalityKeys(cell.column, cell.value)
            if (!cellEquality.length) continue
            for (const anchor of anchors) {
                const id = itemId(anchor.callId, anchor.item)
                const item = items.get(id)
                if (!item) continue
                const direct = cell.strong.flatMap(key => hitsByKey.get(key) ?? []).find(hit => hit.callId === anchor.callId && hit.item === anchor.item)
                const field = direct?.field ?? fieldKeysOf(id, item).find(([, fieldKeys]) => cellEquality.some(key => fieldKeys.has(key)))?.[0]
                if (!field) continue
                const href = hrefFor(item, field)
                const emailCellKey = cell.strong.find(key => key.startsWith('e:'))
                const verdict = emailCellKey ? latestVerdict(emailCellKey) : undefined
                traced[cell.column] = { call: anchor.callId, field, ...(href ? { href } : {}), ...(verdict ? { verdict } : {}) }
                break
            }
        }
        return { sources, cells: traced }
    })

    const usedCallInfo: Record<string, TableSourceCall> = {}
    for (const callId of usedCalls) {
        const { at, capability, servedBy } = calls.get(callId)!
        usedCallInfo[callId] = { capability, servedBy, at }
    }
    return { calls: usedCallInfo, rows: resultRows }
}
