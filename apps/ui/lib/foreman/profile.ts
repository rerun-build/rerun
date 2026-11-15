import 'server-only'

import type { Database, Json } from '@/app/api/database.types'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureWorkspaceNamed } from '@/app/api/_services/naming.service'
import { requestCompanyBrainSeed, requestCompanyExplore } from '@/lib/brain/request-seed'
import { companySiteUrl } from '@/lib/company/firecrawl'
import { asString, asStringArray } from '@/lib/mcp/args'
import { isTemplateCategory } from '@rerun/contracts'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { foremanUseCases } from './phase'
import type { ForemanAnswers, ForemanProfile } from './phase'

export async function readAnswers(ctx: WorkspaceContext): Promise<ForemanAnswers> {
    const { data } = await selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: ctx.workspace.id })
    const value = data?.answers
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ForemanAnswers) : {}
}

export async function writeAnswers(ctx: WorkspaceContext, answers: ForemanAnswers, completed: boolean): Promise<void> {
    const { error } = await ctx.supabase
        .from('workspace_onboarding')
        .upsert<Database['public']['Tables']['workspace_onboarding']['Insert']>({ workspace_id: ctx.workspace.id, answers: answers as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' })
    if (error) throw new Error(error.message)
    if (completed) await stampWorkspaceOnboarded(ctx)
}

export async function stampWorkspaceOnboarded(ctx: WorkspaceContext): Promise<void> {
    const { error } = await ctx.supabase
        .from('workspaces')
        .update<Database['public']['Tables']['workspaces']['Update']>({ onboarded_at: new Date().toISOString() })
        .eq('id', ctx.workspace.id)
        .is('onboarded_at', null)
    if (error) throw new Error(error.message)
}

export async function mergeForeman(ctx: WorkspaceContext, patch: ForemanProfile): Promise<ForemanAnswers> {
    const answers = await readAnswers(ctx)
    const next: ForemanAnswers = { ...answers, foreman: { ...answers.foreman, ...patch } }
    await writeAnswers(ctx, next, false)
    return next
}

async function saveFirstName(ctx: WorkspaceContext, firstName: string): Promise<void> {
    const metadata = ctx.authUser.user_metadata ?? {}
    const fullName = typeof metadata.full_name === 'string' && metadata.full_name ? metadata.full_name : firstName
    await ctx.supabase.auth.admin.updateUserById(ctx.userId, { user_metadata: { ...metadata, first_name: firstName, full_name: fullName } })
}

export async function saveForemanProfile(ctx: WorkspaceContext, args: Record<string, unknown>): Promise<ForemanAnswers> {
    const answers = await readAnswers(ctx)
    const industry = asString(args.industry)
    const tools = asStringArray(args.tools)
    const boxes = asStringArray(args.boxes)

    const useCases = asStringArray(args.use_cases)
    const picked = useCases.length ? useCases : foremanUseCases(answers.foreman ?? {})

    const next: ForemanAnswers = {
        ...answers,
        company_url: asString(args.company_url) ?? answers.company_url,
        company_name: asString(args.company_name) ?? answers.company_name,
        company_description: asString(args.company_description) ?? answers.company_description,
        company_offering: asString(args.company_offering) ?? answers.company_offering,
        company_audience: asString(args.company_audience) ?? answers.company_audience,
        industry: industry && isTemplateCategory(industry) ? industry : answers.industry,
        position: asString(args.position) ?? answers.position,
        tools: tools.length ? tools : answers.tools,
        boxes: boxes.length ? boxes : answers.boxes,
        foreman: {
            ...answers.foreman,
            useCases: picked.length ? picked : undefined,
            pain: picked[0] ?? answers.foreman?.pain,
            language: asString(args.language) ?? answers.foreman?.language,
            profileAt: answers.foreman?.profileAt ?? new Date().toISOString(),
        },
    }

    await writeAnswers(ctx, next, true)

    const firstName = asString(args.first_name)
    if (firstName) await saveFirstName(ctx, firstName)

    const companyUrl = next.company_url ? companySiteUrl(next.company_url) : null
    if (companyUrl && !ctx.authUser.is_anonymous) await requestCompanyExplore(ctx.supabase, ctx.workspace.id, companyUrl).catch(err => console.error('Failed to request a company exploration', ctx.workspace.id, err))

    if (companyUrl && next.foreman?.installedFirst && !answers.foreman?.profileAt && !ctx.authUser.is_anonymous) await requestCompanyBrainSeed(ctx.workspace.id, `brain-seed-${ctx.workspace.id}-profile`)

    await ensureWorkspaceNamed({ workspaceId: ctx.workspace.id, userId: ctx.userId })

    return next
}
