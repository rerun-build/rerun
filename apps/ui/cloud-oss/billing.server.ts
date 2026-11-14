import 'server-only'

export async function extendTrial(_subscriptionId: string, _days: number, _idempotencyKey: string): Promise<boolean> {
    return false
}

export async function syncStripeCustomerEmail(_userId: string, _email: string): Promise<void> {}

export async function subscriptionHasCard(_subscriptionId: string, _timeoutMs: number): Promise<boolean> {
    return false
}

export async function grantRerunTopup(_workspaceId: number, _micros: number): Promise<void> {}

export async function logRerunUsage(_params: { workspaceId: number; engineAgentId?: string | null; model: string; tier: string; inputTokens: number; outputTokens: number; costMicros: number }): Promise<void> {}

export type OpenRouterUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number; cost_details?: { upstream_inference_cost?: number | null } | null }

export function meteredFetch(_onUsage: (usage: OpenRouterUsage) => void): typeof globalThis.fetch {
    return globalThis.fetch
}
