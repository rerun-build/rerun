import { openCoworker, panelAround } from '../steps.mjs'

export default {
    page: 'agents/configure',
    watches: ['apps/ui/components/agent/AgentPanelSettings.tsx', 'apps/ui/components/agent/AgentPanelTools.tsx', 'packages/i18n/messages/en/agent.json'],
    shots: [
        {
            name: 'settings',
            open: async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.leadScout, 'settings'),
            ready: ({ page }) => page.getByText('Soul (system prompt)', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Soul (system prompt)', { exact: true })),
        },
    ],
}
