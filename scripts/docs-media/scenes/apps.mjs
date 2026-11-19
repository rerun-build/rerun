import { openCoworker, panelAround } from '../steps.mjs'

export default {
    page: 'agents/apps',
    watches: ['apps/ui/components/agent/AgentPanelServices.tsx', 'apps/ui/components/services/', 'packages/i18n/messages/en/agent.json', 'packages/i18n/messages/en/services.json'],
    shots: [
        {
            name: 'apps-tab',
            // The CRM filter keeps the library to a few rows, so the panel ends on a whole card.
            open: async ({ page, base, demo }) => {
                await openCoworker(page, base, demo.coworkers.leadScout, 'services')
                await page.getByRole('button', { name: 'CRM', exact: true }).click()
            },
            ready: ({ page }) => page.getByText('From the Vault', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('From the Vault', { exact: true })),
        },
    ],
}
