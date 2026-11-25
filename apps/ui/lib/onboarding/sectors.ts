import type { TemplateCategory } from '@rerun/contracts'

// The lines of work the sign-up offers, wider than the template categories so that more people find
// themselves in one: each still lands on the closest category, whose starter pack it gets. `about` is
// what the models read. The labels and the words people search by are in the language packs
// (`onboarding.sectors`).
export const SECTORS = [
    { id: 'freelance', category: 'productivity', about: 'Freelance, works alone for a few clients' },
    { id: 'agency', category: 'agencies', about: 'Agency' },
    { id: 'consulting', category: 'agencies', about: 'Consulting and coaching' },
    { id: 'creators', category: 'creators', about: 'Creator and media' },
    { id: 'ecommerce', category: 'ecommerce', about: 'Online shop' },
    { id: 'saas', category: 'saas', about: 'Software and tech' },
    { id: 'sales', category: 'sales', about: 'Sales and B2B' },
    { id: 'real-estate', category: 'real-estate', about: 'Real estate' },
    { id: 'legal', category: 'legal', about: 'Legal and compliance' },
    { id: 'finance', category: 'productivity', about: 'Accounting and finance' },
    { id: 'recruiting', category: 'recruiting', about: 'Recruiting and HR' },
    { id: 'health', category: 'other', about: 'Health and wellness' },
    { id: 'education', category: 'other', about: 'Education and training' },
    { id: 'hospitality', category: 'other', about: 'Restaurant and hospitality' },
    { id: 'trades', category: 'other', about: 'Trades and home services' },
    { id: 'nonprofit', category: 'other', about: 'Nonprofit' },
    { id: 'personal', category: 'productivity', about: 'Personal use, no company' },
    { id: 'student', category: 'productivity', about: 'Student, no company' },
] as const satisfies readonly { id: string; category: TemplateCategory; about: string }[]

export type Sector = (typeof SECTORS)[number]
export type SectorId = Sector['id']

// What shows before anyone searches or asks for more: the answers most people give.
export const FIRST_SECTORS: readonly SectorId[] = ['freelance', 'agency', 'ecommerce', 'saas', 'personal', 'student']

export function sectorById(id: string | null | undefined): Sector | null {
    return SECTORS.find(sector => sector.id === id) ?? null
}

/** Someone here for themselves, with no company behind them. */
export function isOwnUse(id: string | null | undefined): boolean {
    return id === 'personal' || id === 'student'
}

const searchable = (text: string) =>
    text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

/** The sectors whose words hold what was typed, accents and case aside. */
export function searchSectors(query: string, wordsOf: (id: SectorId) => string): Sector[] {
    const needle = searchable(query.trim())
    if (!needle) return []
    return SECTORS.filter(sector => searchable(wordsOf(sector.id)).includes(needle))
}
