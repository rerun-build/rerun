import type { ConnectorCatalog } from '@rerun/ui/new-agent'

// The apps the panels draw, as the catalogue lists them, read from the icons the app serves itself:
// nobody is signed in yet, so nothing is fetched. `tone` whitens a mark too dark for a dark surface.
const APPS: [slug: string, name: string, file: string, category: string][] = [
    ['gmail', 'Gmail', 'gmail.svg', 'productivity'],
    ['slack', 'Slack', 'slack.png', 'productivity'],
    ['notion', 'Notion', 'notion.svg?tone=dark', 'productivity'],
    ['google-calendar', 'Google Calendar', 'google-calendar.svg', 'productivity'],
    ['google-sheets', 'Google Sheets', 'google-sheets.svg', 'productivity'],
    ['hubspot', 'HubSpot', 'hubspot.svg', 'crm'],
    ['pipedrive', 'Pipedrive', 'pipedrive.png', 'crm'],
    ['linkedin', 'LinkedIn', 'linkedin.svg', 'marketing'],
    ['instagram', 'Instagram', 'instagram.svg', 'marketing'],
    ['mailchimp', 'Mailchimp', 'mailchimp.svg', 'marketing'],
    ['stripe', 'Stripe', 'stripe.svg', 'payments'],
    ['shopify', 'Shopify', 'shopify.svg', 'ecommerce'],
    ['ahrefs', 'Ahrefs', 'ahrefs.png', 'seo'],
    ['github', 'GitHub', 'github.svg?tone=dark', 'dev'],
]

// A logo is only drawn from an absolute address, which the server does not know.
let catalog: ConnectorCatalog | null = null

export function panelCatalog(): ConnectorCatalog {
    catalog ??= new Map(APPS.map(([slug, name, file, category]) => [slug, { slug, name, icon: `${window.location.origin}/services/${file}`, category }]))
    return catalog
}
