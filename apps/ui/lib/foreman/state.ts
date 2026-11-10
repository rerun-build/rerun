import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { isPaid, type ForemanClient } from '@rerun/contracts'
import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { readAgentShare } from '@/lib/agents/share-read'
import { isSubscriptionEntitled, parsePriceArm, trialArm } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
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

// The reads behind a phase: the profile the foreman keeps on the workspace, and the two tables the
// board map is drawn from. Kept apart from the phase rule itself, which is pure and tested as such.

function readAnswers(value: unknown): ForemanAnswers {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ForemanAnswers) : {}
}

// What the user arrived with, said in a sentence rather than as a slug, plus the short title the
// welcome card names it by. A link that no longer resolves loses both and keeps its kind: the phase
// must not depend on a network read, so the instructions are what handle "a link I could not read".
async function describeIntent(ctx: WorkspaceContext, intent: KickoffIntent): Promise<ArrivingIntent> {
    if (intent.kind === 'prompt') {
        const { apps: picked = [], ...prompt } = intent
        // The slugs come from a URL anyone can write: only the ones the catalogue carries are ever
        // named to an agent.
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

    // A share link is read with the service role, as the card that shows it is: the token is the
    // only credential, and the sender's workspace is not this one.
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
    // A member's foreman sees the board through their Boxes. The phase still reads the whole
    // workspace: a member with nothing open to them is not a workspace to onboard.
    const visibleSpaces = reach ? (spaces ?? []).flatMap(space => (reach.get(space.id) ?? 'none') === 'none' ? [] : [{ ...space, access: reach.get(space.id) as 'use' | 'manage' }]) : (spaces ?? [])
    const visibleSpaceIds = new Set(visibleSpaces.map(space => space.id))
    const visibleAgents = reach ? (agents ?? []).filter(agent => visibleSpaceIds.has(agent.space_id)) : (agents ?? [])

    const answers = readAnswers(onboarding.data?.answers)
    const foreman = answers.foreman ?? {}
    const entitled = isSubscriptionEntitled(ctx.workspace.subscription_status)
    const trialing = ctx.workspace.subscription_status === 'trialing'
    const onboardingCompletedAt = ctx.workspace.onboarded_at ?? null
    const input = { foreman, onboardingCompletedAt, entitled, trialing, agentCount: agents?.length ?? 0, hubForeman: RERUN_CLOUD || !!foremanHubApiKey() }
    // A sandbox is an expert's workspace, handed its machine when it is created: it never goes
    // through the onboarding, and talks to the foreman on that machine from the start.
    const pastOnboarding = ctx.workspace.is_sandbox || foremanPhase(input) === 'companion'
    // The pool is only asked for an account still in the funnel: a companion has its machine, and
    // an anonymous visitor is never stamped, or bot traffic would fill the list.
    const waitlisted = !pastOnboarding && !ctx.authUser.is_anonymous && (await resolveEngineWaitlist(ctx.workspace.id))
    // Read before the phase for once: whether the link still resolves is what decides if it is
    // installed ahead of the welcome card. Only worth a read while it can change anything: a
    // companion was not brought here by a link, it was already home.
    const arriving = intent && !pastOnboarding ? await describeIntent(ctx, intent) : null
    const phase = pastOnboarding ? 'companion' : foremanPhase({ ...input, waitlisted, arrivedReadyMade: isNamedReadyMade(arriving) })

    // A workspace that is already running (paying, or holding agents) is a companion and its funnel
    // will never run, so nothing else would ever stamp it. Left unstamped, every gate that waits on
    // the onboarding (a parked template link, the hero prompt) would wait forever.
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
        // The app sells nothing, so every trial it starts goes without a card, whatever the test's arm.
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
