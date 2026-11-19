// OpenRouter's own cost, or what OpenCode says a step was worth to the user: 0 on the Go plan.
export function costMicrosFrom(providerMetadata: unknown): number | null {
    const metadata = providerMetadata as { openrouter?: { usage?: { cost?: unknown } }; opencode?: { cost?: unknown } } | undefined
    const cost = metadata?.opencode?.cost ?? metadata?.openrouter?.usage?.cost
    return typeof cost === 'number' && Number.isFinite(cost) ? Math.round(cost * 1_000_000) : null
}
