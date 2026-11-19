import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { isPaid, type ForemanClient } from '@moldwright/contracts'
import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { readAgentShare } from '@/lib/agents/share-read'
import { isSubscriptionEntitled, parsePriceArm, trialArm } from '@moldwright/cloud/billing'
import { RERUN_CLOUD } from '@moldwright/cloud/edition'
import { readFirstName } from '@/lib/naming/first-name'
import { loadServiceCatalog } from '@/lib/templates/catalog'
import { LIBRARY_COLUMNS, toLibraryTemplates, type LibraryRow } from '@/lib/templates/library'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { actorFromContext, isAdminActor, spaceAccessMap } from '@/app/api/_auth/access'
import { AGENT_COLUMNS, SPACE_COLUMNS } from './board-map'
import { foremanHubApiKey } from './hub-api-key'
import type { KickoffIntent } from './kickoff-marker'
import { accountLanguage, preferredLanguage } from './language'
import { stampWorkspaceOnboarded } from './profile'
import { foremanPhase, isNamedReadyMade, type ArrivingIntent, type ForemanAnswers, type ForemanState } from './phase'

function readAnswers(value: unknown): ForemanAnswers {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ForemanAnswers) : {}
}

async function describeIntent(ctx: WorkspaceContext, intent: KickoffIntent): Promise<ArrivingIntent> {
    if (intent.kind === 'prompt') {
        const { apps: picked = [], ...prompt } = intent
        const catalog = picked.length ? await loadServiceCatalog(ctx.supabase, picked) : null
        const apps = picked.filter(slug => catalog?.has(slug))
        return { ...prompt, ...(apps.length ? { apps } : {}), description: intent.text }
    }

    if (intent.kind === 'template') {
        const { data } = await selectMaybeSingle(ctx.supabase, 'templates', LIBRARY_COLUMNS, { slug: intent.slug, status: ['published', 'unlisted'] })
        const [template] = data ? toLibraryTemplates([data as LibraryRow], ctx.userId) : []
        if (!template) return intent
        const connectors = template.connectors.map(connector => connector.slug).join(', ')
        const [coworker, ...others] = template.archiveAgentNames
        return { ...intent, title: template.title, ...(coworker && !others.length ? { coworker } : {}), ...(isPaid(template.pricing) && !template.owned ? { paid: template.pricing } : {}), description: `the template "${template.title}" (${template.tagline}), ${template.archiveAgentNames.length} coworkers${connectors ? `, apps: ${connectors}` : ''}` }
    }

    const preview = await readAgentShare(createServiceRoleClient(), intent.token)
    return preview ? { ...intent, title: preview.agent.name, description: `a shared coworker, "${preview.agent.name}"${preview.agent.role ? ` - ${preview.agent.role}` : ''}` } : intent
}

export async function loadForemanState(ctx: WorkspaceContext, acceptLanguage: string | null, intent: KickoffIntent | null = null, client: ForemanClient = 'web'): Promise<ForemanState> {
    const actor = actorFromContext(ctx)
    const [onboarding, { data: spaces }, { data: agents }, reach] = await Promise.all([
        selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: ctx.workspace.id }),
        selectMany(ctx.supabase, 'spaces', SPACE_COLUMNS, { workspace_id: ctx.workspace.id }, { column: 'created_at' }),
        selectMany(ctx.supabase, 'agents', AGENT_COLUMNS, { workspace_id: ctx.workspace.id }, { column: 'created_at' }),
        isAdminActor(actor) ? Promise.resolve(null) : spaceAccessMap(actor),
    ])
    const visibleSpaces = reach ? (spaces ?? []).flatMap(space => (reach.get(space.id) ?? 'none') === 'none' ? [] : [{ ...space, access: reach.get(space.id) as 'use' | 'manage' }]) : (spaces ?? [])
    const visibleSpaceIds = new Set(visibleSpaces.map(space => space.id))
    const visibleAgents = reach ? (agents ?? []).filter(agent => visibleSpaceIds.has(agent.space_id)) : (agents ?? [])

    const answers = readAnswers(onboarding.data?.answers)
    const foreman = answers.foreman ?? {}
    const entitled = isSubscriptionEntitled(ctx.workspace.subscription_status)
    const trialing = ctx.workspace.subscription_status === 'trialing'
    const onboardingCompletedAt = ctx.workspace.onboarded_at ?? null
    const input = { foreman, onboardingCompletedAt, entitled, trialing, agentCount: agents?.length ?? 0, hubForeman: RERUN_CLOUD || !!foremanHubApiKey() }
    const pastOnboarding = ctx.workspace.is_sandbox || foremanPhase(input) === 'companion'
    const waitlisted = !pastOnboarding && !ctx.authUser.is_anonymous && (await resolveEngineWaitlist(ctx.workspace.id))
    const arriving = intent && !pastOnboarding ? await describeIntent(ctx, intent) : null
    const phase = pastOnboarding ? 'companion' : foremanPhase({ ...input, waitlisted, arrivedReadyMade: isNamedReadyMade(arriving) })

    if (phase === 'companion' && !onboardingCompletedAt && !ctx.workspace.is_sandbox && !ctx.authUser.is_anonymous) await stampWorkspaceOnboarded(ctx).catch(err => console.error('Error stamping workspace onboarded', err))

    return {
        phase,
        intent: arriving,
        answers,
        foreman,
        onboardingCompletedAt,
        firstName: readFirstName(ctx.authUser.user_metadata),
        language: accountLanguage((await selectMaybeSingle(ctx.supabase, 'users', ['locale'] as const, { id: ctx.userId })).data?.locale) ?? foreman.language ?? preferredLanguage(acceptLanguage),
        entitled,
        trialing,
        trialSpent: !!ctx.workspace.trial_ends_at,
        trialNeedsCard: client === 'web' && trialArm(ctx.workspace.id) === 'card',
        priceArm: parsePriceArm(ctx.workspace.price_arm),
        client,
        workspaceName: ctx.workspace.name ?? 'this workspace',
        workspacePlan: ctx.workspace.plan ?? 'none',
        userEmail: ctx.userEmail,
        spaces: visibleSpaces,
        agents: visibleAgents,
        hiddenBoxes: (spaces?.length ?? 0) - visibleSpaces.length,
        isMember: !!reach,
    }
}
