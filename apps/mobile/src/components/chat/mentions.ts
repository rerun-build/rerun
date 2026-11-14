import type { BoardAgent, Box, SkillSummary } from '@rerun/contracts'

export type MentionAgent = { id: string; name: string; handle: string | null; hint?: string; preferred?: boolean }
export type MentionItem = ({ kind: 'agent' } & MentionAgent) | ({ kind: 'skill' } & SkillSummary)
export type MentionQuery = { trigger: '@' | '/'; query: string; start: number }

export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
    const match = text.slice(0, caret).match(/(^|\s)([@/])([\w-]*)$/)
    return match ? { trigger: match[2] as '@' | '/', query: match[3], start: caret - match[3].length - 1 } : null
}

export function mentionItems(mention: MentionQuery, agents: MentionAgent[], skills: SkillSummary[]): MentionItem[] {
    const query = mention.query.toLowerCase()
    if (mention.trigger === '/')
        return skills
            .filter(skill => skill.name.toLowerCase().includes(query) || skill.slug.toLowerCase().includes(query))
            .map(skill => ({ kind: 'skill' as const, ...skill }))
            .sort((a, b) => a.name.localeCompare(b.name))
    return agents
        .filter(agent => [agent.name, agent.handle ?? '', agent.hint ?? ''].some(field => field.toLowerCase().includes(query)))
        .map(agent => ({ kind: 'agent' as const, ...agent }))
        .sort((a, b) => Number(b.preferred ?? false) - Number(a.preferred ?? false) || a.name.localeCompare(b.name))
}

export function mentionText(item: MentionItem): string {
    return item.kind === 'skill' ? `/${item.slug}` : `@${item.handle || item.name}`
}

export function insertMention(text: string, caret: number, mention: MentionQuery, item: MentionItem): { text: string; caret: number } {
    const inserted = `${mentionText(item)} `
    return { text: text.slice(0, mention.start) + inserted + text.slice(caret), caret: mention.start + inserted.length }
}

export function insertAtCaret(text: string, caret: number, token: string): { text: string; caret: number } {
    const before = text.slice(0, caret)
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const inserted = `${lead}${token} `
    return { text: before + inserted + text.slice(caret), caret: caret + inserted.length }
}

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
