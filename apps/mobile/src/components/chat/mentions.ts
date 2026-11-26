import { AGENT_KIND_POLICY, FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, type AgentKindPolicy, type BoardAgent, type Box, type SkillSummary } from '@rerun/contracts'

// The web composer's `@` and `/` menus, same strings: the engine reads `@handle` and `/slug` from the
// text through its prompt, nothing parses them on the way.

// `hint` tells apart two coworkers of the same name, by the Box each lives in. `preferred` opens the
// list: the coworkers sharing the Box of the conversation. An `orb`, the Chief of Staff, comes before them.
export type MentionAgent = { id: string; name: string; handle: string | null; hint?: string; preferred?: boolean; look?: AgentKindPolicy['look'] }
// A computer linked to the workspace, `#handle` in a message. Offline ones stay in the list, after the others.
export type MentionComputer = { id: string; name: string; handle: string; online: boolean }
export type MentionItem = ({ kind: 'agent' } & MentionAgent) | ({ kind: 'skill' } & SkillSummary) | ({ kind: 'computer' } & MentionComputer)
export type MentionTrigger = '@' | '/' | '#'
export type MentionQuery = { trigger: MentionTrigger; query: string; start: number }

export const MENTION_TRIGGERS: readonly MentionTrigger[] = ['@', '/', '#']

// Each symbol's strings under `mobileChat.composer.commands`.
export const COMMAND_KEY = { '@': 'coworker', '/': 'skill', '#': 'computer' } as const

// `triggers`: the symbols the composer serves; any other stays plain text.
export function mentionQueryAt(text: string, caret: number, triggers: readonly MentionTrigger[] = MENTION_TRIGGERS): MentionQuery | null {
    const match = text.slice(0, caret).match(/(^|\s)([@/#])([\w-]*)$/)
    if (!match || !triggers.includes(match[2] as MentionTrigger)) return null
    return { trigger: match[2] as MentionTrigger, query: match[3], start: caret - match[3].length - 1 }
}

export function mentionItems(mention: MentionQuery, agents: MentionAgent[], skills: SkillSummary[], computers: MentionComputer[] = []): MentionItem[] {
    const query = mention.query.toLowerCase()
    if (mention.trigger === '#')
        return computers
            .filter(computer => computer.name.toLowerCase().includes(query) || computer.handle.includes(query))
            .map(computer => ({ kind: 'computer' as const, ...computer }))
            .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    if (mention.trigger === '/')
        return skills
            .filter(skill => skill.name.toLowerCase().includes(query) || skill.slug.toLowerCase().includes(query))
            .map(skill => ({ kind: 'skill' as const, ...skill }))
            .sort((a, b) => a.name.localeCompare(b.name))
    return agents
        .filter(agent => [agent.name, agent.handle ?? '', agent.hint ?? ''].some(field => field.toLowerCase().includes(query)))
        .map(agent => ({ kind: 'agent' as const, ...agent }))
        .sort((a, b) => Number(b.look === 'orb') - Number(a.look === 'orb') || Number(b.preferred ?? false) - Number(a.preferred ?? false) || a.name.localeCompare(b.name))
}

export function mentionText(item: MentionItem): string {
    if (item.kind === 'computer') return `#${item.handle}`
    return item.kind === 'skill' ? `/${item.slug}` : `@${item.handle || item.name}`
}

// Replaces what was typed after the trigger, up to the caret, with the token and a space.
export function insertMention(text: string, caret: number, mention: MentionQuery, item: MentionItem): { text: string; caret: number } {
    const inserted = `${mentionText(item)} `
    return { text: text.slice(0, mention.start) + inserted + text.slice(caret), caret: mention.start + inserted.length }
}

// A token dropped at the caret, from a menu rather than typed: spaced from the words around it.
export function insertAtCaret(text: string, caret: number, token: string): { text: string; caret: number } {
    const before = text.slice(0, caret)
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const inserted = `${lead}${token} `
    return { text: before + inserted + text.slice(caret), caret: caret + inserted.length }
}

// A mention symbol typed from a menu: spaced from the word before it, and left bare so its suggestions open.
export function insertTrigger(text: string, caret: number, trigger: MentionTrigger): { text: string; caret: number } {
    const before = text.slice(0, caret)
    const inserted = before.length > 0 && !/\s$/.test(before) ? ` ${trigger}` : trigger
    return { text: before + inserted + text.slice(caret), caret: caret + inserted.length }
}

// Every other live coworker of the workspace answers to `call_agent`, whichever Box it sits in. Its own
// Box opens the list, and only the others carry a Box name. The Foreman, in no Box, sees them all named.
export function mentionAgentsOf(agents: BoardAgent[], boxes: Box[], selfId: string | null): MentionAgent[] {
    const self = selfId ? agents.find(agent => agent.id === selfId) : undefined
    const boxNames = new Map(boxes.map(box => [box.id, box.name]))
    return agents
        .filter(agent => agent.id !== selfId && !agent.disabledAt)
        .map(agent => {
            const sameBox = self !== undefined && agent.spaceId === self.spaceId
            return { id: agent.id, name: agent.name, handle: agent.handle, hint: sameBox ? undefined : (boxNames.get(agent.spaceId) ?? undefined), preferred: sameBox }
        })
}

// The Chief of Staff answers `call_agent` under its fixed id: the engine does not know the name the
// workspace gave it, so it is mentioned `@foreman`, its role beside a name it was given. `label` is the
// name a chat shows for it (`foremanLabel`).
export function foremanMention(label: string): MentionAgent {
    return { id: FOREMAN_AGENT_ID, name: label, handle: FOREMAN_AGENT_ID, hint: label === FOREMAN_DISPLAY_NAME ? undefined : FOREMAN_DISPLAY_NAME, look: AGENT_KIND_POLICY.foreman.look }
}
