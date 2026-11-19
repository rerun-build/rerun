import { isTemplateCategory, SOFTWARE_STUDIO, type TemplateCategory } from '@moldwright/contracts'

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

export const STUDIO_BOX_NAMES = ['Prototypes', 'Products', 'Tools', 'Infra', 'Research', 'Personal']

export const DEFAULT_BOX_NAMES = ['Marketing', 'Sales', 'Ops', 'Support', 'Finance', 'Personal']

const MAX_SUGGESTIONS = 4

export function divisionExamples(industry: string | null | undefined): string[] | null {
    if (industry === SOFTWARE_STUDIO) return STUDIO_BOX_NAMES
    return industry && isTemplateCategory(industry) && INDUSTRY_BOX_NAMES[industry].length > 0 ? INDUSTRY_BOX_NAMES[industry] : null
}

export function boxNameSuggestions(industry: string | null | undefined, taken: string[], localize: (name: string) => string = name => name): string[] {
    const used = new Set(taken.map(name => name.trim().toLowerCase()))
    return (divisionExamples(industry) ?? DEFAULT_BOX_NAMES).map(localize).filter(name => !used.has(name.toLowerCase())).slice(0, MAX_SUGGESTIONS)
}
