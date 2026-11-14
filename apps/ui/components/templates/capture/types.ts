import type { AgentCapturePlan, CaptureSelection, CaptureSourceSpace } from '@/lib/templates/capture'

export type CaptureSourcesResult = { ok: true; spaces: CaptureSourceSpace[] } | { ok: false; error: string }
export type CapturePlanResult = { ok: true; plans: AgentCapturePlan[] } | { ok: false; error: string }
export type CaptureRunResult = { ok: true; captured: number; warnings: string[] } | { ok: false; error: string }

export type CaptureActions = {
    listSources: () => Promise<CaptureSourcesResult>
    plan: (input: { spaceId: string; agentIds: string[] }) => Promise<CapturePlanResult>
    capture: (input: { spaceId: string; selections: CaptureSelection[] }) => Promise<CaptureRunResult>
}
