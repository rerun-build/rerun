import type { BrainProposal } from '@rerun/contracts'

export type Section = { heading: string | null; body: string }

export type SectionChange = {
    key: string
    heading: string | null
    kind: 'added' | 'removed' | 'changed' | 'same'
    before: string
    after: string
}

const HEADING = /^(#{1,6})\s+(.*)$/

// A lone "-" or blank bullet is what the seed leaves behind when a fact was missing: noise for the
// reviewer, never a change worth reading.
const isNoiseLine = (line: string) => /^\s*-?\s*$/.test(line)

const normalizeBody = (body: string) =>
    body
        .split('\n')
        .filter(line => !isNoiseLine(line))
        .join('\n')
        .trim()

// The page title already sits above the page, so a `# Title` line the agent adds is formatting,
// not content. Only `##` and deeper split the page.
export function sectionsOf(markdown: string): Section[] {
    const sections: Section[] = [{ heading: null, body: '' }]
    for (const line of markdown.split('\n')) {
        const heading = HEADING.exec(line)
        if (heading && heading[1].length === 1) continue
        if (heading) sections.push({ heading: heading[2].trim(), body: '' })
        else sections[sections.length - 1].body += `${line}\n`
    }
    return sections.map(section => ({ ...section, body: normalizeBody(section.body) })).filter(section => section.heading !== null || section.body)
}

const keyOf = (heading: string | null) => (heading ?? '').trim().toLowerCase()

export function sectionChanges(before: string | null, after: string): SectionChange[] {
    const beforeSections = new Map(sectionsOf(before ?? '').map(section => [keyOf(section.heading), section]))
    const changes: SectionChange[] = []
    for (const section of sectionsOf(after)) {
        const key = keyOf(section.heading)
        const previous = beforeSections.get(key)
        beforeSections.delete(key)
        if (!previous) changes.push({ key, heading: section.heading, kind: 'added', before: '', after: section.body })
        else changes.push({ key, heading: section.heading, kind: previous.body === section.body ? 'same' : 'changed', before: previous.body, after: section.body })
    }
    for (const [key, section] of beforeSections) changes.push({ key, heading: section.heading, kind: 'removed', before: section.body, after: '' })
    return changes
}

export const changedOnly = (changes: SectionChange[]) => changes.filter(change => change.kind !== 'same')

export const proposalChanges = (proposal: BrainProposal) => changedOnly(sectionChanges(proposal.currentContent, proposal.content))

// A proposal made before the coworkers wrote a headline, or on an engine not updated yet, has none.
// The `brain.proposals` catalog.
export type ProposalHeadlineCopy = (key: 'headlineCreate' | 'headlineEdit', values: { title: string }) => string

export const proposalHeadline = (proposal: BrainProposal, t: ProposalHeadlineCopy) => proposal.headline ?? t(proposal.mode === 'create' ? 'headlineCreate' : 'headlineEdit', { title: proposal.title })

export const humanAgentName = (name: string) => name.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

// A stable angle per seed, so every beam catches the light somewhere else without moving between renders.
export function beamAngle(seed: string) {
    let hash = 0
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return hash % 360
}
