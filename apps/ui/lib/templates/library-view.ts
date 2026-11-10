import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateConnector } from '@rerun/contracts'
import { isInMyLibrary, type LibraryCreator, type LibraryTemplate } from './library'

// Where the library's rail points. Discover is the editorial home; every other view is one list.
export type LibraryView = { kind: 'discover' } | { kind: 'foryou' } | { kind: 'all' } | { kind: 'mine' } | { kind: 'category'; category: TemplateCategory } | { kind: 'app'; slug: string } | { kind: 'creator'; slug: string }

export const DISCOVER_VIEW: LibraryView = { kind: 'discover' }

export function isSameView(a: LibraryView, b: LibraryView): boolean {
    if (a.kind !== b.kind) return false
    if (a.kind === 'category' && b.kind === 'category') return a.category === b.category
    if (a.kind === 'creator' && b.kind === 'creator') return a.slug === b.slug
    if (a.kind === 'app' && b.kind === 'app') return a.slug === b.slug
    return true
}

export function templatesInView(templates: LibraryTemplate[], view: LibraryView, signals: ViewerSignals = {}): LibraryTemplate[] {
    switch (view.kind) {
        case 'discover':
        case 'all':
            return templates
        case 'foryou':
            return rankForViewer(templates, signals)
        case 'mine':
            return templates.filter(isInMyLibrary)
        case 'category':
            return templates.filter(t => t.category === view.category)
        case 'app':
            return templates.filter(t => t.connectors.some(c => c.slug === view.slug))
        case 'creator':
            return templates.filter(t => t.creator?.slug === view.slug)
    }
}

// A template with one agent reads best under that agent's name, "Inbound Lead Qualifier", which is
// short and says the job, with the title's longer sentence under it. With several, the title names
// the whole and the agents follow; with none yet, the tagline does.
export function templateHeadline(template: { title: string; tagline: string; agents: { name: string }[] }): { headline: string; subline: string } {
    const [only, ...others] = template.agents
    if (only && others.length === 0) return { headline: only.name, subline: template.title }
    if (only) return { headline: template.title, subline: template.agents.map(agent => agent.name).join(', ') }
    return { headline: template.title, subline: template.tagline }
}

export function matchesQuery(template: LibraryTemplate, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [template.title, template.tagline, template.creator?.name ?? '', ...template.agents.map(agent => agent.name), ...template.tags].some(field => field.toLowerCase().includes(q))
}

// "Other" goes last whatever its size: it is the drawer, not a shelf anyone came for.
export function categoryCounts(templates: LibraryTemplate[]): { category: TemplateCategory; count: number }[] {
    return TEMPLATE_CATEGORIES.map(category => ({ category, count: templates.filter(t => t.category === category).length }))
        .filter(row => row.count > 0)
        .sort((a, b) => Number(a.category === 'other') - Number(b.category === 'other') || b.count - a.count)
}

export type AppCount = { connector: TemplateConnector; count: number }

export function appCounts(templates: LibraryTemplate[]): AppCount[] {
    const bySlug = new Map<string, AppCount>()
    for (const connector of templates.flatMap(t => t.connectors)) {
        const entry = bySlug.get(connector.slug) ?? { connector, count: 0 }
        entry.count += 1
        bySlug.set(connector.slug, entry)
    }
    return [...bySlug.values()].sort((a, b) => b.count - a.count || a.connector.name.localeCompare(b.connector.name))
}

const STACK_SIZE = 6

// The apps the viewer said they use, when they told us and the catalogue has something for them;
// the catalogue's most used otherwise, which is what a stack looks like for most people.
export function stackApps(templates: LibraryTemplate[], connectorSlugs: string[] = []): { mine: boolean; apps: AppCount[] } {
    const all = appCounts(templates)
    const mine = all.filter(app => connectorSlugs.includes(app.connector.slug))
    return mine.length > 0 ? { mine: true, apps: mine } : { mine: false, apps: all.slice(0, STACK_SIZE) }
}

export type LibraryCreatorSummary = LibraryCreator & { templates: LibraryTemplate[] }

// Template authors first, most templates first, the name breaking ties so the row does not
// reshuffle between two reads. The directory's other creators follow in the order it was read, so
// Discover can introduce people who have not published a template yet.
export function creatorSummaries(templates: LibraryTemplate[], directory: LibraryCreator[] = []): LibraryCreatorSummary[] {
    const bySlug = new Map<string, LibraryCreatorSummary>()
    for (const template of templates) {
        if (!template.creator) continue
        const summary = bySlug.get(template.creator.slug) ?? { ...template.creator, templates: [] }
        summary.templates.push(template)
        bySlug.set(template.creator.slug, summary)
    }
    const authors = [...bySlug.values()].sort((a, b) => b.templates.length - a.templates.length || a.name.localeCompare(b.name))
    const others = directory.filter(creator => !bySlug.has(creator.slug)).map(creator => ({ ...creator, templates: [] }))
    return [...authors, ...others]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Nobody curates the spotlight yet, so it rotates on its own: one creator per calendar week, the
// same one for everybody, in a fixed order so the turn comes back round.
export function creatorOfTheWeek(creators: LibraryCreatorSummary[], now: Date): { creator: LibraryCreatorSummary; template: LibraryTemplate } | null {
    const authors = creators.filter(creator => creator.templates.length > 0)
    if (authors.length === 0) return null
    const ordered = [...authors].sort((a, b) => a.slug.localeCompare(b.slug))
    const creator = ordered[Math.floor(now.getTime() / WEEK_MS) % ordered.length]
    const template = creator.templates.find(t => t.featured) ?? creator.templates[0]
    return { creator, template }
}

const POPULAR_CREATORS = 2

// The row Discover introduces: the most published first, then a fresh draw from everybody else on
// every open, so the same few faces do not hold the page. `seed` keeps one draw stable while the
// dialog stays open.
export function creatorsToMeet(creators: LibraryCreatorSummary[], { exclude, seed, count }: { exclude?: string; seed: number; count: number }): LibraryCreatorSummary[] {
    const candidates = creators.filter(creator => creator.slug !== exclude)
    const popular = candidates.filter(creator => creator.templates.length > 0).slice(0, POPULAR_CREATORS)
    const rest = seededShuffle(
        candidates.filter(creator => !popular.includes(creator)),
        seed,
    )
    return [...popular, ...rest].slice(0, count)
}

function seededShuffle<T>(items: T[], seed: number): T[] {
    const shuffled = [...items]
    let state = seed >>> 0
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

export type ViewerSignals = { category?: TemplateCategory | null; connectorSlugs?: string[] }

export function hasViewerSignals(signals: ViewerSignals): boolean {
    return (!!signals.category && signals.category !== 'other') || (signals.connectorSlugs?.length ?? 0) > 0
}

// What the onboarding told us outranks the editorial order, which still breaks ties: one point per
// app the viewer uses, two for their industry since that is the stronger signal of the two.
export function rankForViewer(templates: LibraryTemplate[], signals: ViewerSignals): LibraryTemplate[] {
    const apps = new Set(signals.connectorSlugs ?? [])
    const score = (t: LibraryTemplate) => (signals.category && signals.category !== 'other' && t.category === signals.category ? 2 : 0) + t.connectors.filter(c => apps.has(c.slug)).length + (t.featured ? 0.5 : 0)
    return [...templates].sort((a, b) => score(b) - score(a))
}

export function newestFirst(templates: LibraryTemplate[]): LibraryTemplate[] {
    return [...templates].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}

const CREATOR_KINDS: readonly LibraryCreator['kind'][] = ['studio', 'freelancer', 'expert']

// The `templates.creatorKind` catalog.
export type CreatorKindCopy = (key: LibraryCreator['kind']) => string

export function creatorKindLabel(kind: LibraryCreator['kind'], t: CreatorKindCopy): string {
    return t(CREATOR_KINDS.includes(kind) ? kind : 'expert')
}
