'use server'

import { z } from 'zod'
import { requireSandboxAuthorSession } from '@/app/api/_auth/expert'
import { captureAuthorAgents, listAuthorCaptureSources, planAuthorCapture, removeAuthorTemplateAgent } from '@/lib/templates/author-capture'
import { captureSetupSchema, type AgentCapturePlan, type CaptureSourceSpace } from '@/lib/templates/capture'

import type { ActionResult } from './space.actions'
import { failureOf } from '@/lib/i18n/action-error'

// The runtime half of expert authoring: the same capture the admin console runs, scoped to what the
// caller owns. Every action re-resolves the sandbox, the template and the agents, so the client only
// ever supplies ids that are checked against the caller before anything reaches the engine. The
// checks themselves live in `lib/templates/author-capture.ts`, shared with the MCP server.

const planInputSchema = z.object({
    templateId: z.string().uuid(),
    spaceId: z.string().uuid(),
    agentIds: z.array(z.string().uuid()).min(1, 'Select at least one coworker.'),
})

const captureInputSchema = z.object({
    templateId: z.string().uuid(),
    spaceId: z.string().uuid(),
    selections: z
        .array(
            z.object({
                agentRowId: z.string().uuid(),
                exclude: z.array(z.string()).default([]),
                setup: captureSetupSchema.optional(),
            }),
        )
        .min(1, 'Select at least one coworker.'),
})

const removeAgentInputSchema = z.object({
    templateId: z.string().uuid(),
    agentKey: z.string().min(1),
})

export async function listMyCaptureSourcesAction(): Promise<ActionResult<{ spaces: CaptureSourceSpace[] }>> {
    try {
        return { ok: true, spaces: await listAuthorCaptureSources(await requireSandboxAuthorSession()) }
    } catch (err) {
        return failureOf(err, 'listBoxesFailed')
    }
}

export async function planMyCaptureAction(input: unknown): Promise<ActionResult<{ plans: AgentCapturePlan[] }>> {
    try {
        const scope = await requireSandboxAuthorSession()
        return { ok: true, plans: await planAuthorCapture(scope, planInputSchema.parse(input)) }
    } catch (err) {
        return failureOf(err, 'inspectCoworkersFailed')
    }
}

export async function captureMyAgentsAction(input: unknown): Promise<ActionResult<{ captured: number; warnings: string[] }>> {
    try {
        const scope = await requireSandboxAuthorSession()
        const { captured, warnings } = await captureAuthorAgents(scope, captureInputSchema.parse(input))
        return { ok: true, captured, warnings }
    } catch (err) {
        return failureOf(err, 'captureCoworkersFailed')
    }
}

export async function removeMyTemplateAgentAction(input: unknown): Promise<ActionResult> {
    try {
        const scope = await requireSandboxAuthorSession()
        await removeAuthorTemplateAgent(scope, removeAgentInputSchema.parse(input))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'removeCoworkerFailed')
    }
}
