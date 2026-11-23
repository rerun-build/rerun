import { FOREMAN_AGENT_ID } from './foreman.js'
import type { ToolKey } from './agent.js'

// A coworker is one of two kinds: one the workspace hired (`coworker`), or the Chief of Staff every
// workspace has (`foreman`). The Chief of Staff does everything a coworker does unless its policy
// below says otherwise: a reader asks the policy, never `id === FOREMAN_AGENT_ID`.
export const AGENT_KINDS = ['coworker', 'foreman'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export type AgentKindPolicy = {
    deletable: boolean
    duplicable: boolean
    // Downloaded as an archive, or published as a template.
    exportable: boolean
    // Shared with people outside the workspace.
    shareable: boolean
    // Its soul, its install prompt, its name and description on the engine are written by a person.
    // When false the engine rewrites them from code at every boot.
    soulEditable: boolean
    // Has an installation to run or skip (`automations/activate`).
    installable: boolean
    // Sits in a cell of the board, inside a Box.
    onBoard: boolean
    // Listed by `team_status`, the check-in digest and the other coworkers' roster of their team.
    inTeamStatus: boolean
    // `shared`: everyone who sees the coworker reads its conversations. `per-member`: each member
    // talks to it alone, with their own rights.
    conversations: 'shared' | 'per-member'
    // How it is drawn: a buddy of the board, or the orb.
    look: 'buddy' | 'orb'
    // The capabilities a person cannot switch off: without them it is not what its kind promises.
    lockedTools: readonly ToolKey[]
}

export const AGENT_KIND_POLICY: Record<AgentKind, AgentKindPolicy> = {
    coworker: {
        deletable: true,
        duplicable: true,
        exportable: true,
        shareable: true,
        soulEditable: true,
        installable: true,
        onBoard: true,
        inTeamStatus: true,
        conversations: 'shared',
        look: 'buddy',
        lockedTools: [],
    },
    foreman: {
        deletable: false,
        duplicable: false,
        exportable: false,
        shareable: false,
        soulEditable: false,
        installable: false,
        onBoard: false,
        inTeamStatus: false,
        conversations: 'per-member',
        look: 'orb',
        lockedTools: ['hub', 'cards', 'askUser', 'requestApproval', 'requestSecret', 'suggestService', 'team', 'callAgent', 'notify', 'quickReplies'],
    },
}

// The engine knows the Chief of Staff by its fixed id.
export function agentKindOfEngineId(engineAgentId: string): AgentKind {
    return engineAgentId === FOREMAN_AGENT_ID ? 'foreman' : 'coworker'
}

// How the apps and the notification rules name a coworker: its row, or `foreman` for the Chief of
// Staff, whose row differs from one workspace to the next and whom the shipped apps open by that name.
export function agentAddress(agent: { id: string; kind: AgentKind }): string {
    return agent.kind === 'foreman' ? FOREMAN_AGENT_ID : agent.id
}

export function agentKindPolicy(kind: AgentKind): AgentKindPolicy {
    return AGENT_KIND_POLICY[kind]
}
