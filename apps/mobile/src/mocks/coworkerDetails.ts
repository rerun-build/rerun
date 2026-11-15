import type { CoworkerFile, CoworkerFiles, InstalledServiceView, RoutineView } from '@rerun/contracts'

const app = (slug: string, name: string, status: InstalledServiceView['status'], label?: string): InstalledServiceView => ({ key: slug, slug, name, label, icon: null, category: 'productivity', status, toolNames: [], installedAt: '2026-10-01T09:00:00.000Z' })

export const MOCK_APPS: InstalledServiceView[] = [app('gmail', 'Gmail', 'active', 'ada@acme.com'), app('hubspot', 'HubSpot', 'active'), app('linkedin', 'LinkedIn', 'active', 'Clément Janssens')]

export const MOCK_APPS_TO_CONNECT: InstalledServiceView[] = [app('gmail', 'Gmail', 'needs_auth'), app('hubspot', 'HubSpot', 'active'), app('stripe', 'Stripe', 'needs_config'), app('notion', 'Notion', 'error')]

export const MOCK_ROUTINES: RoutineView[] = [
    { kind: 'schedule', slug: 'morning-leads', name: 'Morning leads', enabled: true, cronLabel: 'At 09:00 AM, Monday through Friday', runAt: null, timezone: 'Europe/Paris' },
    { kind: 'schedule', slug: 'weekly-digest', name: 'Weekly digest', enabled: false, cronLabel: 'At 05:00 PM, only on Friday', runAt: null, timezone: 'Europe/Paris' },
    { kind: 'schedule', slug: 'follow-up-acme', name: 'Follow up with Acme', enabled: true, cronLabel: null, runAt: '2026-11-04T09:30:00.000Z', timezone: null },
    { kind: 'trigger', slug: 'new-signup', name: 'New signup', enabled: true, cronLabel: null, runAt: null, timezone: null },
]

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const file = (path: string, size: number, days: number): CoworkerFile => ({ path, name: path.split('/').pop()!, size, modifiedAt: daysAgo(days), kind: /\.(png|jpe?g|webp)$/i.test(path) ? 'media' : 'doc' })

export const MOCK_FILES: CoworkerFiles = {
    files: [
        file('reports/leads-chart.png', 182_000, 0),
        file('leads/lyon-agencies.csv', 48_200, 0),
        file('reports/weekly-recap.pdf', 412_000, 1),
        file('screens/linkedin-profile.jpg', 240_000, 2),
        file('screens/acme-homepage.jpg', 310_000, 3),
        file('drafts/cold-email.md', 3_400, 4),
        file('reports/pipeline.png', 96_000, 6),
        file('leads/q4-prospects.xlsx', 88_000, 38),
        file('screens/crm-export.webp', 120_000, 40),
        file('notes/meeting-acme.docx', 22_000, 45),
    ],
    truncated: false,
}

export const mockFileUrl = (entry: CoworkerFile) => `https://picsum.photos/seed/${encodeURIComponent(entry.name)}/300`
