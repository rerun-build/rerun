import { openCoworker, panelAround } from '../steps.mjs'

export default {
    page: 'agents/automations',
    watches: ['apps/ui/components/agent/AgentPanelScheduled.tsx', 'apps/ui/components/agent/AgentPanelTriggers.tsx', 'apps/ui/components/routines/', 'packages/i18n/messages/en/agent.json'],
    shots: [
        {
            name: 'scheduled-tasks',
            open: async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.leadScout, 'scheduled'),
            ready: ({ page }) => page.getByText('Monday prospects', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Monday prospects', { exact: true })),
            // A panel is as tall as the window: a shorter one ends near the list.
            height: 560,
        },
        {
            name: 'triggers',
            open: async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.invoiceChaser, 'triggers'),
            ready: ({ page }) => page.getByText('Stripe payment', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Stripe payment', { exact: true })),
            height: 560,
        },
    ],
}
