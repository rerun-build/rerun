export function requireString(v: unknown, field: string): string {
    if (typeof v !== 'string' || !v) throw new Error(`Missing required argument: ${field}`)
    return v
}

export function asString(v: unknown): string | undefined {
    return typeof v === 'string' && v ? v : undefined
}

export function asNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function asStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

export function asBooleanRecord(v: unknown): Record<string, boolean> | undefined {
    if (!v || typeof v !== 'object') return undefined
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) if (typeof value === 'boolean') out[key] = value
    return Object.keys(out).length > 0 ? out : undefined
}

export function clamp(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined) return fallback
    return Math.min(Math.max(Math.trunc(value), 1), max)
}

export function requireConfirmation(args: Record<string, unknown>, what: string): void {
    if (args.confirm !== true) throw new Error(`This deletes ${what} for good. Call again with confirm: true once the account owner has agreed.`)
}

export function requireAgreement(args: Record<string, unknown>, what: string): void {
    if (args.confirm !== true) {
        throw new Error(`This sends ${what} out of the workspace, readable by anyone holding the link. Call again with confirm: true once the account owner has agreed.`)
    }
}
