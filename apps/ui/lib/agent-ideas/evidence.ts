import type { BrainPage } from '@rerun/contracts'

import type { CompanyFinding, CompanyFindingsRow } from '@/lib/company/explore/findings'
import { describeNeed } from '@/lib/foreman/needs'
import { foremanUseCases, type ForemanAnswers } from '@/lib/foreman/phase'
import type { Evidence, EvidenceDraft } from './types'

const TEXT_MAX = 420
const EVIDENCE_MAX = 160

const SKIPPED_HEADINGS = new Set(['related'])

const SKIPPED_PAGES = new Set(['open-questions'])

function flatten(text: string): string {
    return text
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug: string, label?: string) => label ?? slug)
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TEXT_MAX)
}

function blocks(body: string): string[] {
    const found: string[] = []
    let paragraph: string[] = []
    const flush = () => {
        if (paragraph.length) found.push(paragraph.join(' '))
        paragraph = []
    }
    for (const line of body.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) flush()
        else if (/^[-*]\s+/.test(trimmed)) {
            flush()
            found.push(trimmed.replace(/^[-*]\s+/, ''))
        } else paragraph.push(trimmed)
    }
    flush()
    return found
}

export function brainEvidence(pages: BrainPage[]): EvidenceDraft[] {
    return pages
        .filter(page => !SKIPPED_PAGES.has(page.slug))
        .flatMap(page => {
            const sections = page.content.split(/^##\s+/m)
            const intro = sections.shift() ?? ''
            const titled = sections.map(section => {
                const [heading = '', ...rest] = section.split('\n')
                return { heading: heading.trim(), body: rest.join('\n') }
            })
            return [{ heading: '', body: intro }, ...titled]
                .filter(section => !SKIPPED_HEADINGS.has(section.heading.toLowerCase()))
                .flatMap(section =>
                    blocks(section.body).map(block => ({
                        source: `brain:${page.slug}`,
                        topic: section.heading ? `${page.title} / ${section.heading}` : page.title,
                        text: flatten(block),
                    }))
                )
        })
}

function findingText(finding: CompanyFinding): { topic: string; text: string } | null {
    switch (finding.kind) {
        case 'tools':
            return finding.tools.length ? { topic: 'Tools spotted', text: `Uses ${finding.tools.map(tool => tool.name).join(', ')}` } : null
        case 'mail':
            return { topic: 'Email', text: `Runs its email on ${finding.provider}` }
        case 'social':
            return finding.networks.length ? { topic: 'Social presence', text: `Present on ${finding.networks.map(network => (network.audience ? `${network.name} (${network.audience})` : network.name)).join(', ')}` } : null
        case 'registry': {
            const facts = [finding.founded ? `founded ${finding.founded}` : null, finding.headcount ? `headcount ${finding.headcount}` : null, finding.city ? `based in ${finding.city}` : null].filter(Boolean)
            return facts.length ? { topic: 'Public registry', text: `Registered company: ${facts.join(', ')}` } : null
        }
        case 'person':
            return { topic: 'Account owner', text: `${finding.name}${finding.headline ? `, ${finding.headline}` : ''}` }
        case 'linkedin': {
            const facts = [finding.followers !== null ? `${finding.followers} followers` : null, finding.employees !== null ? `${finding.employees} employees listed` : null].filter(Boolean)
            return facts.length ? { topic: 'LinkedIn page', text: `Company LinkedIn page: ${facts.join(', ')}` } : null
        }
        case 'reviews':
            return { topic: 'Google reviews', text: `Rated ${finding.rating} from ${finding.count} Google reviews` }
        case 'customers':
            return finding.items.length ? { topic: 'Notable customers', text: `Customers named: ${finding.items.join(', ')}` } : null
        case 'identity':
        case 'audience':
        case 'products':
        case 'competitors':
        case 'brand':
        case 'brain':
            return null
    }
}

export function findingsEvidence(row: CompanyFindingsRow | null): EvidenceDraft[] {
    return (row?.findings ?? []).flatMap(finding => {
        const described = findingText(finding)
        return described ? [{ source: `findings:${finding.kind}`, topic: described.topic, text: flatten(described.text) }] : []
    })
}

export function answersEvidence(answers: ForemanAnswers, { withProfile }: { withProfile: boolean }): EvidenceDraft[] {
    const drafts: EvidenceDraft[] = []
    const add = (source: string, topic: string, text: string | undefined) => {
        if (text?.trim()) drafts.push({ source, topic, text: flatten(text) })
    }

    if (withProfile) {
        add('answers:profile', 'Company', [answers.company_name, answers.company_description].filter(Boolean).join(': '))
        add('answers:profile', 'Offering', answers.company_offering)
        add('answers:profile', 'Audience', answers.company_audience)
    }
    add('answers:industry', 'Industry', answers.industry)
    if (answers.tools?.length) add('answers:tools', 'Apps they picked', `Picked these apps at onboarding, in this order: ${answers.tools.join(', ')}`)

    const foreman = answers.foreman ?? {}
    for (const useCase of foremanUseCases(foreman)) add('interview:use-case', 'Job they asked to hand over first', useCase)
    for (const need of foreman.needs ?? []) add('interview:need', 'What goes wrong today', describeNeed(need))
    return drafts
}

export function buildEvidence(...sources: EvidenceDraft[][]): Evidence[] {
    const seen = new Set<string>()
    const kept: EvidenceDraft[] = []
    for (const draft of sources.flat()) {
        const key = draft.text.toLowerCase()
        if (!draft.text || seen.has(key)) continue
        seen.add(key)
        kept.push(draft)
    }
    return kept.slice(0, EVIDENCE_MAX).map((draft, index) => ({ id: `E${index + 1}`, ...draft }))
}

export function evidenceForPrompt(evidence: Evidence[]): string {
    return evidence.map(item => `[${item.id}] (${item.source}) ${item.topic}: ${item.text}`).join('\n')
}
