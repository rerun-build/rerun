import { getSystemDb, systemDbExists } from '../systemDb.js'

export type UsageStep = {
    agentId: string
    runId: string
    jobRef: string | null
    provider: string | null
    model: string | null
    at: string
    freshInput: number
    output: number
    cacheWrite: number
    cacheRead: number
}

export type UsageGroup = {
    agentId: string
    jobRef: string | null
    provider: string | null
    model: string | null
    runs: number
    steps: number
    freshInput: number
    output: number
    cacheWrite: number
    cacheRead: number
    total: number
}

export type ToolCallCount = { agentId: string; toolName: string; calls: number; errors: number }

function num(value: unknown): number {
    const n = Number(value ?? 0)
    return Number.isFinite(n) ? n : 0
}

function str(value: unknown): string | null {
    return value === null || value === undefined ? null : String(value)
}

export async function listUsageSteps(agentIds: string[], sinceIso: string | null): Promise<UsageStep[]> {
    const steps: UsageStep[] = []
    for (const agentId of agentIds) {
        if (!systemDbExists(agentId)) continue
        const { client } = await getSystemDb(agentId)
        const result = await client.execute({
            sql: `SELECT s.run_id AS run_id, r.job_ref AS job_ref, s.provider AS provider, s.model AS model,
                    s.created_at AS at, s.input_tokens AS input_tokens, s.output_tokens AS output_tokens,
                    s.cached_input_tokens AS cached, s.cache_write_tokens AS written
                FROM run_steps s JOIN runs r ON s.run_id = r.id
                WHERE (? IS NULL OR s.created_at >= ?)
                ORDER BY s.created_at ASC`,
            args: [sinceIso, sinceIso],
        })
        for (const row of result.rows) {
            const cacheRead = num(row.cached)
            const cacheWrite = num(row.written)
            steps.push({
                agentId,
                runId: String(row.run_id),
                jobRef: str(row.job_ref),
                provider: str(row.provider),
                model: str(row.model),
                at: String(row.at),
                freshInput: Math.max(0, num(row.input_tokens) - cacheRead - cacheWrite),
                output: num(row.output_tokens),
                cacheWrite,
                cacheRead,
            })
        }
    }
    return steps.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function groupUsage(steps: UsageStep[]): UsageGroup[] {
    const groups = new Map<string, UsageGroup>()
    const runIds = new Map<string, Set<string>>()
    for (const step of steps) {
        const key = JSON.stringify([step.agentId, step.jobRef, step.provider, step.model])
        let group = groups.get(key)
        if (!group) {
            group = {
                agentId: step.agentId,
                jobRef: step.jobRef,
                provider: step.provider,
                model: step.model,
                runs: 0,
                steps: 0,
                freshInput: 0,
                output: 0,
                cacheWrite: 0,
                cacheRead: 0,
                total: 0,
            }
            groups.set(key, group)
            runIds.set(key, new Set())
        }
        const ids = runIds.get(key)!
        ids.add(step.runId)
        group.runs = ids.size
        group.steps += 1
        group.freshInput += step.freshInput
        group.output += step.output
        group.cacheWrite += step.cacheWrite
        group.cacheRead += step.cacheRead
        group.total = group.freshInput + group.output + group.cacheWrite + group.cacheRead
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
}

export async function listToolCallCounts(agentIds: string[], sinceIso: string | null): Promise<ToolCallCount[]> {
    const rows: ToolCallCount[] = []
    for (const agentId of agentIds) {
        if (!systemDbExists(agentId)) continue
        const { client } = await getSystemDb(agentId)
        const result = await client.execute({
            sql: `SELECT tool_name, count(*) AS calls, coalesce(sum(is_error), 0) AS errors
                FROM tool_calls
                WHERE (? IS NULL OR created_at >= ?)
                GROUP BY tool_name`,
            args: [sinceIso, sinceIso],
        })
        for (const row of result.rows) {
            rows.push({ agentId, toolName: String(row.tool_name), calls: num(row.calls), errors: num(row.errors) })
        }
    }
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    return rows.sort((a, b) => b.calls - a.calls || cmp(a.toolName, b.toolName) || cmp(a.agentId, b.agentId))
}
