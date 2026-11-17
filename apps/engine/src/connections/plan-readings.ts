import type { PlanLimitWindow } from '@rerun/contracts'
import { raw } from '../db/client.js'

export type PlanReading = {
    connectionId: string
    kind: string
    label: string
    usedPercent: number
    resetsAt: string | null
    capturedAt: string
}

let ready: Promise<void> | null = null

function ensureTable(): Promise<void> {
    if (!ready) {
        ready = raw()
            .executeMultiple(
                `CREATE TABLE IF NOT EXISTS plan_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    used_percent REAL NOT NULL,
    resets_at TEXT,
    captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_readings_connection_captured ON plan_readings (connection_id, captured_at);`
            )
            .catch(error => {
                ready = null
                throw error
            })
    }
    return ready
}

export async function saveReadings(connectionId: string, windows: PlanLimitWindow[], capturedAt: string): Promise<void> {
    await ensureTable()
    for (const window of windows) {
        const label = window.label ?? ''
        const latest = await raw().execute({
            sql: 'SELECT used_percent, resets_at FROM plan_readings WHERE connection_id = ? AND kind = ? AND label = ? ORDER BY captured_at DESC, id DESC LIMIT 1',
            args: [connectionId, window.kind, label]
        })
        const row = latest.rows[0]
        if (row && Number(row.used_percent) === window.usedPercent && (row.resets_at ?? null) === window.resetsAt) continue
        await raw().execute({
            sql: 'INSERT INTO plan_readings (connection_id, kind, label, used_percent, resets_at, captured_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [connectionId, window.kind, label, window.usedPercent, window.resetsAt, capturedAt]
        })
    }
}

export async function listReadings(sinceIso: string | null, kind: string): Promise<PlanReading[]> {
    await ensureTable()
    const result = await raw().execute({
        sql: 'SELECT connection_id, kind, label, used_percent, resets_at, captured_at FROM plan_readings WHERE kind = ? AND (? IS NULL OR captured_at >= ?) ORDER BY captured_at ASC, id ASC',
        args: [kind, sinceIso, sinceIso]
    })
    return result.rows.map(row => ({
        connectionId: String(row.connection_id),
        kind: String(row.kind),
        label: String(row.label),
        usedPercent: Number(row.used_percent),
        resetsAt: row.resets_at === null ? null : String(row.resets_at),
        capturedAt: String(row.captured_at)
    }))
}

export async function latestReadings(sinceIso: string): Promise<PlanReading[]> {
    await ensureTable()
    const result = await raw().execute({
        sql: `SELECT connection_id, kind, label, used_percent, resets_at, captured_at FROM plan_readings p
WHERE captured_at >= ? AND id = (SELECT id FROM plan_readings q WHERE q.connection_id = p.connection_id AND q.kind = p.kind AND q.label = p.label ORDER BY captured_at DESC, id DESC LIMIT 1)
ORDER BY connection_id, kind, label`,
        args: [sinceIso]
    })
    return result.rows.map(row => ({
        connectionId: String(row.connection_id),
        kind: String(row.kind),
        label: String(row.label),
        usedPercent: Number(row.used_percent),
        resetsAt: row.resets_at === null ? null : String(row.resets_at),
        capturedAt: String(row.captured_at)
    }))
}
