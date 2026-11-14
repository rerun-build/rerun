import 'server-only'

import { actorFromContext, workspaceActor, type Actor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { analyzeCompanyProfile } from '@/lib/company/profile'
import { asString, requireString } from '@/lib/mcp/args'
import { installAgentShare, type AgentShareInstallOutcome } from '@/lib/agents/share-install'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { installTemplate, type TemplateInstallOutcome } from '@/lib/templates/install'
import { hasTemplateEntitlement, templateAccessByWorkspace } from '@/lib/templates/entitlement'
import { LIBRARY_COLUMNS, toLibraryTemplates, type LibraryRow, type LibraryTemplate } from '@/lib/templates/library'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { revisedJob, type RevisedJob } from './needs'
import { readPlanBoxes, readPlanItems } from './plan-items'
import { mergeForeman, saveForemanProfile } from './profile'
import { startAgentSetup } from './setup-handoff'
import type { ForemanPlan, ForemanProfile } from './phase'
import type { PlanItemKind } from './tool-defs'

type TemplateBrief = { slug: string; title: string; tagline: string; category: string; agents: number; connectors: string[]; setupMinutes: number }

const TEMPLATE_LIMIT = 8

export type WorkspaceActor = Pick<WorkspaceContext, 'supabase' | 'userId'> & { workspace: Pick<WorkspaceContext['workspace'], 'id'>; actor?: Actor }

async function saveProfile(ctx: WorkspaceContext, args: Record<string, unknown>): Promise<unknown> {
    const profile = await saveForemanProfile(ctx, args)

    if (profile.foreman?.installedFirst) return { saved: true, profile, next: 'That was the last thing missing: their coworker is already installed and running its own setup. Stop here, with one line saying you now know who they are and that you stay around if they need anything.' }

    return { saved: true, profile, next: 'Discovery is done. Keep going in the same turn: this is now the plan step, so design the one coworker for the job their company visibly does every week and read it back with show_plan. Nothing is created yet.' }
}

function brief(template: LibraryTemplate): TemplateBrief {
    return {
        slug: template.slug,
        title: template.title,
        tagline: template.tagline,
        category: template.category,
        agents: template.archiveAgentNames.length,
        connectors: template.connectors.map(connector => connector.slug),
        setupMinutes: template.setupMinutes,
    }
}

async function listTemplates(ctx: WorkspaceActor, args: Record<string, unknown>): Promise<unknown> {
    const category = asString(args.category)
    const query = asString(args.query)?.toLowerCase()

    const [{ data }, access] = await Promise.all([selectMany(ctx.supabase, 'templates', LIBRARY_COLUMNS, { status: 'published', show_in_library: true }, { column: 'published_at', ascending: false }), templateAccessByWorkspace(ctx.supabase, ctx.workspace.id)])

    const templates = toLibraryTemplates((data ?? []) as LibraryRow[], ctx.userId, access)
        .filter(template => template.owned && template.archiveAgentNames.length > 0)
        .filter(template => (category ? template.category === category : true))
        .filter(template => (query ? `${template.title} ${template.tagline} ${template.tags.join(' ')}`.toLowerCase().includes(query) : true))

    const ranked = [...templates].sort((a, b) => Number(b.featured) - Number(a.featured))
    return { templates: ranked.slice(0, TEMPLATE_LIMIT).map(brief), total: ranked.length }
}

export type WrittenPlan = Pick<ForemanProfile, 'plan' | 'planAt' | 'installedFirst'> & Partial<RevisedJob>

export async function writePlan(ctx: WorkspaceContext, shown: unknown, kinds: readonly PlanItemKind[], asked: string | null = null, installedFirst = false, interview: ForemanProfile | null = null): Promise<WrittenPlan> {
    const args = (shown ?? {}) as Record<string, unknown>
    const items = readPlanItems(args.items, kinds).map(item => (asked && item.kind === 'agent' ? { ...item, asked } : item))
    if (!items.length) throw new Error('A plan needs its one item: the coworker for the job they picked, with its name and its role.')

    const plan: ForemanPlan = { title: asString(args.title) ?? 'Your first coworker', items, boxes: readPlanBoxes(args.boxes) }
    const revised = interview ? revisedJob(interview, items[0]) : null
    const written: WrittenPlan = { plan, planAt: new Date().toISOString(), ...(installedFirst ? { installedFirst } : {}), ...revised }
    await mergeForeman(ctx, written)
    return written
}

export async function installFromLibrary(ctx: WorkspaceActor, args: Record<string, unknown>, { purchased = false }: { purchased?: boolean } = {}): Promise<TemplateInstallOutcome> {
    const slug = requireString(args.slug, 'slug')
    const boxId = requireString(args.boxId, 'boxId')

    const { data: space } = await selectMaybeSingle(ctx.supabase, 'spaces', ['id'] as const, { id: boxId, workspace_id: ctx.workspace.id })
    if (!space) throw new Error(`No Box with id ${boxId} in this workspace.`)

    const { data: template } = await selectMaybeSingle(ctx.supabase, 'templates', ['id', 'pricing_model', 'creator_id'] as const, { slug })
    if (!template) throw new Error(`No template found with slug "${slug}"`)
    if (template.pricing_model !== 'free') {
        if (!purchased) throw new Error(`"${slug}" is a paid template. Build the coworkers yourself with create_agent instead of installing it.`)
        if (!(await hasTemplateEntitlement(ctx.supabase, ctx.workspace.id, template, ctx.userId))) throw new Error(`"${slug}" has not been bought for this workspace yet.`)
    }

    return installTemplate(ctx.supabase, slug, { workspaceId: ctx.workspace.id, spaceId: boxId, actor: ctx.actor ?? workspaceActor(ctx.workspace.id) })
}

export async function installFromShare(ctx: WorkspaceActor, args: Record<string, unknown>): Promise<AgentShareInstallOutcome> {
    const token = requireString(args.token, 'token')
    const boxId = requireString(args.boxId, 'boxId')

    const { data: space } = await selectMaybeSingle(ctx.supabase, 'spaces', ['id'] as const, { id: boxId, workspace_id: ctx.workspace.id })
    if (!space) throw new Error(`No Box with id ${boxId} in this workspace.`)

    return installAgentShare(createServiceRoleClient(), token, { workspaceId: ctx.workspace.id, spaceId: boxId, actor: ctx.actor ?? workspaceActor(ctx.workspace.id) })
}

export async function dispatchWorkspaceOnboardingTool(ctx: WorkspaceActor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'analyze_website':
            return analyzeCompanyProfile(requireString(args.url, 'url'))
        case 'list_templates':
            return listTemplates(ctx, args)
        case 'install_template':
            return installFromLibrary(ctx, args)
        case 'install_shared_agent':
            return installFromShare(ctx, args)
        case 'start_agent_setup':
            return startAgentSetup(ctx, args)
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}

export async function dispatchOnboardingTool(ctx: WorkspaceContext, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'save_profile':
            return saveProfile(ctx, args)
        default:
            return dispatchWorkspaceOnboardingTool({ ...ctx, actor: actorFromContext(ctx) }, name, args)
    }
}
