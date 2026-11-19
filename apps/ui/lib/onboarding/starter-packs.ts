import { MAX_STARTER_PICKS, type TemplateCategory } from '@moldwright/contracts'

export type StarterCard = { template: string; promise: string; line?: string; focus?: string }

export { MAX_STARTER_PICKS }

const ASSISTANT: StarterCard = { template: 'executive-assistant', promise: 'Brief me every morning', focus: 'Prepare the morning briefing' }
const INVOICES: StarterCard = { template: 'collections-officer', promise: 'Chase my unpaid invoices', focus: 'Chase overdue invoices' }
const PROJECTS: StarterCard = { template: 'project-manager', promise: 'Keep my projects on track', focus: 'Plan a project' }
const BOOKS: StarterCard = { template: 'general-accountant', promise: 'Close my books every month', focus: 'Prepare the period entries' }
const HIRING: StarterCard = { template: 'recruiter', promise: 'Find my next hire', focus: 'Build the candidate shortlist' }

const EVERYONE: StarterCard[] = [ASSISTANT, PROJECTS, INVOICES, BOOKS, HIRING]

export const STARTER_PACKS: Record<TemplateCategory, StarterCard[]> = {
    'real-estate': [
        { template: 'real-estate-agent', promise: 'Find owners about to sell', focus: 'Find likely sellers' },
        { template: 'property-manager', promise: 'Run your rentals without the chasing', focus: 'Screen the applications' },
        { template: 'real-estate-investment-analyst', promise: 'Know if a deal is worth it', focus: 'Analyse the deal' },
        ASSISTANT,
        INVOICES,
    ],
    agencies: [
        { template: 'sales-development-rep', promise: 'Find your next clients', focus: 'Build the prospect list' },
        { template: 'seo-consultant', promise: 'Get found on Google', focus: "Audit the site's SEO" },
        { template: 'project-manager', promise: 'Deliver client projects on time', focus: 'Plan a project' },
        ASSISTANT,
        INVOICES,
    ],
    saas: [
        { template: 'sales-development-rep', promise: 'Book more demos', focus: 'Write the outreach' },
        { template: 'customer-success-manager', promise: 'Save accounts before they churn', focus: 'Review account health' },
        { template: 'product-marketing-manager', promise: 'Make the next launch land', focus: 'Write the launch brief' },
        ASSISTANT,
        PROJECTS,
    ],
    sales: [
        { template: 'sales-development-rep', promise: 'Book more meetings', focus: 'Write the outreach' },
        { template: 'sales-manager', promise: 'See the pipeline before your Monday call', focus: 'Call the weekly forecast' },
        { template: 'b2b-account-executive', promise: 'Walk into every meeting prepared', focus: 'Brief the sales meeting' },
        ASSISTANT,
        INVOICES,
    ],
    ecommerce: [
        { template: 'ecommerce-manager', promise: 'Know what your store did this week', focus: 'Read the week' },
        { template: 'crm-marketing-manager', promise: 'Win back the abandoned carts', focus: 'Recover the carts' },
        { template: 'fulfilment-coordinator', promise: 'Get the orders out the door', focus: 'Prioritise the shipments' },
        ASSISTANT,
        BOOKS,
    ],
    creators: [
        { template: 'social-media-manager', promise: 'Post everywhere without doing it twice', focus: "Plan the week's posts" },
        { template: 'editorial-lead', promise: 'Never run out of content ideas', focus: 'Plan the editorial calendar' },
        { template: 'editorial-writer', promise: 'Turn one idea into a finished article', focus: 'Write the blog article' },
        ASSISTANT,
        INVOICES,
    ],
    legal: [
        { template: 'contract-manager', promise: 'Review contracts before you sign', focus: 'Review the contract' },
        { template: 'compliance-manager', promise: 'Stay audit-ready', focus: 'Run the gap assessment' },
        { template: 'litigation-lawyer', promise: 'Build a case file from a client matter', focus: 'Build the case file' },
        ASSISTANT,
        INVOICES,
    ],
    recruiting: [
        { template: 'recruiter', promise: 'Find and screen your next hires', focus: 'Build the candidate shortlist' },
        { template: 'hr-administrator', promise: 'Onboard every new hire properly', focus: 'Plan the onboarding' },
        { template: 'payroll-specialist', promise: 'Run payroll without the errors', focus: 'Audit the payroll' },
        ASSISTANT,
        PROJECTS,
    ],
    productivity: EVERYONE,
    other: EVERYONE,
}

export function starterPack(industry: TemplateCategory | null | undefined): StarterCard[] {
    return STARTER_PACKS[industry ?? 'other'] ?? STARTER_PACKS.other
}
