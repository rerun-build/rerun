import 'server-only'

import { workspaceActor } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { createAgent, deriveUniqueHandles, findFreeCellsInSpace } from '@/app/api/_services/agent.service'
import { createBoxesBatch } from '@/app/api/_services/box.service'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { freeAgentSlots } from '@/app/api/_services/capacity.service'
import type { SubRunTask } from '@/lib/chat/sub-run-progress'
import type { GridPosition } from '@/lib/board/types'
import { getAgent as engineGetAgent, patchAgent } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { installFromLibrary, installFromShare } from './onboarding-tools'
import type { ArrivingIntent, ForemanPlanItem, ForemanState } from './phase'
import { mergeForeman } from './profile'
import { installWithFocus } from './starter-pack'
import { foremanProfileBlock } from './prompt'
import { beginSubRun, endSubRun, snapshotSubRun, startHeartbeat, type SubRunProgress } from './sub-run-watch'

// The whole build, run by the app the moment the trial is on: no model is called anywhere in it.
// The user has just said yes, and every second between that and a team at work is one they spend
// deciding whether to stay.
//
// So nothing is written before the agents exist. Each one is created on a first draft of its SOUL,
// all of them at once, and none of them starts: each carries an install, where it sets itself up with
// the user and writes the rest itself: its real SOUL, its skills and its schedules, once it has done
// the job once. The lead, the agent they picked on the card, is the one the Foreman hands them a
// button for (startLeadSetupAction); the others wait in their own chat, whenever they like: three
// agents asking for sign-ins at once is a team nobody answers.

// The first message an installed agent gets when its author shipped no install of its own.
export const PLAIN_KICKOFF = 'You have just joined this workspace. Introduce yourself in two lines, then do your job once on their real company and show them the result.'

export type BuildTeamOptions = {
    ctx: WorkspaceContext
    state: ForemanState
    emit: (tasks: SubRunTask[]) => void
    signal?: AbortSignal
}

type BuiltBox = { boxId: string; name: string; col: number; row: number; colEnd: number; rowEnd: number }

type BuiltAgent = { agentId: string; name: string; boxId: string; active: boolean; lead?: boolean }

export type BuildTeamLead = { agentId: string; name: string }

export type BuildTeamResult = { boxes: BuiltBox[]; agents: BuiltAgent[]; failed: { name: string; error: string }[]; lead: BuildTeamLead | null }

type AgentItem = Extract<ForemanPlanItem, { kind: 'agent' }>

const nameKey = (name: string) => name.trim().toLowerCase()

export function titleOf(item: ForemanPlanItem): string {
    if (item.kind === 'agent') return item.name
    if (item.kind === 'template') return item.title ?? item.slug
    return item.name ?? 'Shared coworker'
}

// What they typed in the landing composer, word for word: the card of the plan is one line, and the
// rest of what they asked for, when it runs and on what, only exists in their own sentence.
function websiteAsk(intent: ArrivingIntent | null | undefined): string | null {
    return intent?.kind === 'prompt' ? `What they asked for in their own words, before signing up: "${intent.text}"` : null
}

// The same for what they wrote when they sent the plan card back: the card that came back confirmed
// kept one line of it.
function revisionAsk(item: AgentItem): string | null {
    return item.asked ? `What they asked for when they changed the plan, in their own words:\n<brief>\n${item.asked}\n</brief>` : null
}

// What the plan card told them this agent hands over: the shape its work comes back in, which a
// list of rows without the reason each one is there does not have.
function promisedBlock(item: AgentItem): string | null {
    const lines = [...(item.gets ?? []).map(get => `- ${get}`), item.delivered ? `Each run ends with: ${item.delivered}` : null].filter(Boolean)
    return lines.length ? `What the plan they confirmed promised you hand back:\n${lines.join('\n')}` : null
}

export function onboardingSoul(item: AgentItem, state: ForemanState): string {
    const company = state.answers.company_name || state.workspaceName
    const team = (state.foreman.plan?.items ?? []).filter(other => other !== item).map(other => `- ${titleOf(other)}${other.kind === 'agent' ? `: ${other.role}` : ''}`)
    const profile = foremanProfileBlock(state)

    return [
        `# ${item.name}`,
        `You work for ${company}. Your job: ${item.role}.`,
        item.need ? `Why they hired you: ${item.need}.` : null,
        websiteAsk(state.intent),
        revisionAsk(item),
        promisedBlock(item),
        profile || null,
        team.length ? `The rest of the team, so you do not do their work:\n${team.join('\n')}` : null,
        'This is a first draft, written the moment you were hired. Once you have done your job once with the user and know their apps and how they work, rewrite this whole SOUL with soul_update: what you do for them, how you decide, what you must never do, and the format of what you hand back.',
        'Talk to the user in the language they write in, keep your answers short, and never make up data you did not read.',
    ]
        .filter(Boolean)
        .join('\n\n')
}

// Ordered for the first result rather than for a complete setup: they judge an agent on what it
// hands back in its first conversation, so everything that only makes it better later comes after.
export function onboardingInstall(item: AgentItem, intent: ArrivingIntent | null = null): string {
    const ask = websiteAsk(intent)
    const asked = ask ? ` ${ask}. Do that job, and if they said when it should run, that is the schedule you create.` : ''
    const picked = intent?.kind === 'prompt' && intent.apps?.length ? ` They already picked these apps on the website: ${intent.apps.join(', ')}. Offer those, plus any other the job cannot run without.` : ''
    const aim = item.need ? ` They told you what goes wrong there: ${item.need}. Your first result goes straight at that.` : ''
    const target = item.need ? ', aimed at what they told you goes wrong' : ''
    const shape = item.gets?.length ? `, in the shape the plan promised them (${item.gets.join('; ')})` : ''
    const revision = revisionAsk(item)
    const brief = revision ? `\n\n${revision}\nThat is the brief: your first result follows it, and you never ask again for something it already says.` : ''

    return `You have just been hired to ${item.role.charAt(0).toLowerCase()}${item.role.slice(1)}. Nothing is connected yet and this is your first conversation with the user. Get them a first real result that holds up: they judge you on what you hand back, not on your setup.${aim}${asked}${brief}

1. Introduce yourself in two lines: what you will do for them.
2. If this job cannot run without one of their apps (their mailbox, their CRM, the place their posts go out from), first show what you can already do without it: the job done on what is public (their site or store, its catalogue and pages) or on a sample you label as one. Then offer every one of those apps at once with suggest_service, each tied to what it adds to that result, and end your turn.${picked} A skipped app is an answer: keep delivering on what is public and say what the app would add, never that the job is on hold. A job that needs no app skips this step.
3. Ask with ask_user only for what you cannot start without. When what you hand back is a list of people or companies, what makes one of them fit (who exactly, where, on which criteria) is part of that: ask it in one ask_user, unless the brief already says it. Everything else can wait.
4. Do the job once, on their real data${target}, and show them the result${shape}.
5. Then settle in: rewrite your SOUL with soul_update now that you know how they work, create a scheduled task with schedule_create if this job runs on its own (ask their timezone if you do not know it), and record what you learned with memory_write.
6. Call install_complete with a one line summary of what is now set up. In the message that closes the setup, propose keeping the way you did this job as a skill with skill_propose.

If a step fails, say so plainly and fix it with them, and never call install_complete while something the job needs is still missing, unless they chose to go on without it.`
}

// Every division of the plan, then any Box an item names that the list forgot, in reading order.
function boxNamesOf(state: ForemanState): string[] {
    const plan = state.foreman.plan
    const names = [...(plan?.boxes ?? []).map(box => box.name), ...(plan?.items ?? []).flatMap(item => (item.box ? [item.box] : []))]
    const unique = names.filter((name, index) => names.findIndex(other => nameKey(other) === nameKey(name)) === index)
    return unique.length ? unique : [plan?.title || state.workspaceName]
}

export async function buildTeam({ ctx, state, emit, signal }: BuildTeamOptions): Promise<BuildTeamResult> {
    const plan = state.foreman.plan
    if (!plan?.items.length) throw new Error('There is no confirmed plan to build. Show the plan again and wait for it to come back confirmed.')

    const progress: SubRunProgress[] = plan.items.map(item => ({ title: titleOf(item), status: 'queued', steps: 0 }))
    const publish = () => emit(progress.map(snapshotSubRun))
    const touch = (index: number, activity: string) => {
        progress[index].activity = activity
        progress[index].steps += 1
        progress[index].lastActivityAt = Date.now()
        publish()
    }
    publish()
    const stopHeartbeat = startHeartbeat(publish)
    const actor = workspaceActor(ctx.workspace.id)

    try {
        // A Box already on the board under the same name is reused: a build that stopped halfway is
        // run again from the top, and it must not lay a second copy of their company beside the first.
        const existing = new Map(state.spaces.flatMap(space => (space.name ? [[nameKey(space.name), space] as const] : [])))
        const boxes: BuiltBox[] = []
        const failed: BuildTeamResult['failed'] = []
        const missing = boxNamesOf(state).filter(name => !existing.has(nameKey(name)))
        const created = await createBoxesBatch({ workspaceId: ctx.workspace.id, userId: ctx.userId, actor, names: missing })
        const spaceIdByName = new Map([...existing].map(([key, space]) => [key, space.id]))
        created.forEach((result, index) => {
            if (!result.ok) {
                failed.push({ name: missing[index], error: result.error })
                return
            }
            spaceIdByName.set(nameKey(missing[index]), result.spaceId)
            boxes.push({ boxId: result.spaceId, name: result.name, col: result.colStart, row: result.rowStart, colEnd: result.colEnd, rowEnd: result.rowEnd })
        })
        const fallbackSpaceId = spaceIdByName.values().next().value
        if (!fallbackSpaceId) throw new Error(failed[0]?.error ?? 'No Box could be created, so there is nowhere to build the team.')

        const spaceIdOf = (item: ForemanPlanItem) => (item.box && spaceIdByName.get(nameKey(item.box))) || fallbackSpaceId
        const entries = plan.items.map((item, index) => ({ item, index, spaceId: spaceIdOf(item) }))
        const agentEntries = entries.filter((entry): entry is typeof entry & { item: AgentItem } => entry.item.kind === 'agent')

        // Everything createAgent would read then write is decided here, once, so the agents can be
        // created all at once: the slots go to the first agents of the plan, and every handle and
        // every cell is handed out against the ones already given.
        const supabase = createServiceRoleClient()
        const [slots, handles, cells] = await Promise.all([freeAgentSlots(ctx.workspace.id), deriveUniqueHandles(supabase, ctx.workspace.id, agentEntries.map(entry => entry.item.name)), cellsBySpace(supabase, agentEntries)])

        const agents: BuiltAgent[] = []
        const results = await Promise.all(
            agentEntries.map(async ({ item, index, spaceId }, order) => {
                if (signal?.aborted) return null
                beginSubRun(progress[index])
                touch(index, 'create_agent')
                // The first agent of the plan is the one that starts. A plan confirmed before the
                // onboarding went down to one agent still holds several.
                const lead = order === 0
                try {
                    const agent = await createAgent({
                        name: item.name,
                        description: item.role,
                        soulMd: onboardingSoul(item, state),
                        installMd: onboardingInstall(item, state.intent),
                        workspaceId: ctx.workspace.id,
                        spaceId,
                        actor,
                        handle: handles[order],
                        enabled: order < slots,
                        position: cells.get(spaceId)?.shift(),
                        // Left pending on purpose, unlike an agent written through create_agent: the
                        // install is its own first conversation, not a copy's, and it is what puts the
                        // install button in its chat.
                        config: { setup: { required: true, completedAt: null } },
                    })
                    endSubRun(progress[index])
                    return { agentId: agent.id, name: agent.name, boxId: spaceId, active: !agent.disabled_at, lead }
                } catch (err) {
                    const reason = err instanceof Error ? err.message : String(err)
                    endSubRun(progress[index], reason)
                    failed.push({ name: item.name, error: reason })
                    return null
                } finally {
                    publish()
                }
            })
        )
        for (const result of results) if (result) agents.push(result)

        // A ready-made item is never beside an agent of the plan (readPlanItems refuses the mix), so
        // these run alone, one at a time: installTemplate claims its own slots as it goes.
        for (const { item, index, spaceId } of entries) {
            if (item.kind === 'agent' || signal?.aborted) continue
            beginSubRun(progress[index])
            touch(index, item.kind === 'template' ? 'install_template' : 'install_shared_agent')
            try {
                if (item.kind === 'template') {
                    const outcome = await installFromLibrary(ctx, { slug: item.slug, boxId: spaceId }, { purchased: true })
                    for (const agentId of outcome.agentIds) agents.push({ agentId, name: titleOf(item), boxId: spaceId, active: true })
                    const focus = item.focus
                    if (focus) await Promise.all(outcome.agentIds.map(agentId => focusInstall(ctx.workspace.id, agentId, focus)))
                    for (const miss of outcome.failed) failed.push({ name: miss.name, error: miss.error })
                } else {
                    const outcome = await installFromShare(ctx, { token: item.token, boxId: spaceId })
                    agents.push({ agentId: outcome.agentId, name: outcome.agentName, boxId: spaceId, active: !outcome.inactive })
                }
                endSubRun(progress[index])
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err)
                endSubRun(progress[index], reason)
                failed.push({ name: titleOf(item), error: reason })
            }
            publish()
        }

        // Nothing starts here: the lead, the one they picked or the first one a link brought in, waits
        // for the button the Foreman puts under the build. The funnel still ends now, or the next turn
        // would be the model's, setting up the whole team at once.
        const leader = agents.find(agent => agent.lead) ?? agents[0]
        let lead: BuildTeamLead | null = null
        if (leader) {
            leader.lead = true
            lead = { agentId: leader.agentId, name: leader.name }
            await mergeForeman(ctx, { firstRunAt: new Date().toISOString() })
        }

        return { boxes, agents, failed, lead }
    } finally {
        stopHeartbeat()
        for (const task of progress) if (task.status === 'queued' || task.status === 'running') endSubRun(task, 'the build was stopped')
        publish()
    }
}

// A starter card sold one use case of the template: its install is opened on that skill before
// anyone starts it, from the Foreman's button or from the coworker's own chat. Best effort: a coworker
// with no slot cannot be reached yet, and it still installs as its author wrote it.
async function focusInstall(workspaceId: number, agentId: string, focus: string): Promise<void> {
    try {
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, workspaceActor(workspaceId), 'manage')
        const detail = await engineGetAgent(conn, engineAgentId)
        if (!detail.install.trim()) return
        await patchAgent(conn, engineAgentId, { install: installWithFocus(detail.install, focus) })
    } catch (err) {
        console.error('[foreman] could not open the install on its focus:', err instanceof Error ? err.message : err)
    }
}

async function cellsBySpace(supabase: ReturnType<typeof createServiceRoleClient>, entries: { spaceId: string }[]): Promise<Map<string, GridPosition[]>> {
    const counts = new Map<string, number>()
    for (const { spaceId } of entries) counts.set(spaceId, (counts.get(spaceId) ?? 0) + 1)
    const found = await Promise.all([...counts].map(async ([spaceId, count]) => [spaceId, await findFreeCellsInSpace(supabase, spaceId, count)] as const))
    return new Map(found)
}
