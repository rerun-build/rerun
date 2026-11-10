import { isTemplateCategory } from '@/lib/onboarding/industries'
import type { TemplateCategory } from '@rerun/contracts'

// Names offered under the Box name field, so the field is not an empty page.
//
// A Box only groups agents: they all run on the same machine and can call each other across Boxes,
// so no name below cuts a handoff. Every one of them is still a top level division, something a
// company already runs as its own thing: Marketing, Sales, Ops, because that is the grain someone
// recognises in a picker, not because a finer one would break anything.
//
// Hand written per industry, same reasoning as INDUSTRY_TOOLS: the template catalogue is shaped by
// capability, not by how a business divides itself, and a suggestion that misses is worse than a
// generic one. Six each, the most universal first, so four survive once the Boxes already created
// are out.
export const INDUSTRY_BOX_NAMES: Record<TemplateCategory, string[]> = {
    agencies: ['Clients', 'Marketing', 'New Business', 'Operations', 'Finance', 'Personal'],
    ecommerce: ['Store', 'Marketing', 'Customer Care', 'Supply Chain', 'Finance', 'Personal'],
    saas: ['Product', 'Engineering', 'Marketing', 'Support', 'Sales', 'Finance'],
    sales: ['Sales', 'Marketing', 'Accounts', 'Operations', 'Finance', 'Personal'],
    recruiting: ['Recruiting', 'Clients', 'Marketing', 'Operations', 'Finance', 'Personal'],
    'real-estate': ['Listings', 'Clients', 'Marketing', 'Legal', 'Operations', 'Finance'],
    legal: ['Clients', 'Compliance', 'New Business', 'Operations', 'Finance', 'Personal'],
    creators: ['Content', 'Business', 'Community', 'Sponsors', 'Finance', 'Personal'],
    productivity: ['Work', 'Personal', 'Projects', 'Admin', 'Finance', 'Clients'],
    other: [],
}

// Someone whose site told us nothing we can bucket, or who skipped the question, gets the divisions
// that read as separate whatever the business. These are the Boxes the illustration beside the field
// already draws, so the suggestion and the picture say the same thing.
export const DEFAULT_BOX_NAMES = ['Marketing', 'Sales', 'Ops', 'Support', 'Finance', 'Personal']

// Wide enough to still show four once a couple are taken, short enough to stay two rows of pills.
const MAX_SUGGESTIONS = 4

// The divisions a business of this kind already runs, whole, or null when the industry says nothing
// worth saying. The caller decides what to do with that: a picker falls back to the universal list,
// while a prompt is better off dropping the line than repeating a generic one twice.
//
// Takes a plain string, not a `TemplateCategory`: the stored answer comes back out of a jsonb
// column, so it is whatever was written there once, including a label a later revision drops.
export function divisionExamples(industry: string | null | undefined): string[] | null {
    return industry && isTemplateCategory(industry) && INDUSTRY_BOX_NAMES[industry].length > 0 ? INDUSTRY_BOX_NAMES[industry] : null
}

// `localize` writes the English name in the reader's language before it is compared with the Boxes
// already there, which carry whatever language they were named in.
export function boxNameSuggestions(industry: string | null | undefined, taken: string[], localize: (name: string) => string = name => name): string[] {
    const used = new Set(taken.map(name => name.trim().toLowerCase()))
    return (divisionExamples(industry) ?? DEFAULT_BOX_NAMES).map(localize).filter(name => !used.has(name.toLowerCase())).slice(0, MAX_SUGGESTIONS)
}
