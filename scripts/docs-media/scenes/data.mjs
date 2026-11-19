import { dialog, openCoworker, openWorkspaceMenu, panelAround } from '../steps.mjs'

export default {
    page: 'agents/data',
    watches: ['apps/ui/components/agent/AgentPanelData.tsx', 'apps/ui/components/data/', 'apps/ui/components/published/PublishPolicyField.tsx', 'packages/i18n/messages/en/data.json', 'packages/i18n/messages/en/published.json'],
    shots: [
        {
            name: 'database-tab',
            open: async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.invoiceChaser, 'data'),
            ready: ({ page }) => page.getByText('Quillmate', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Quillmate', { exact: true })),
            height: 600,
        },
        {
            name: 'public-links-policy',
            open: async ({ page, base }) => {
                await openWorkspaceMenu(page, base)
                await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
            },
            ready: ({ page }) => dialog({ page }).getByText('Nothing goes public', { exact: true }),
            frame: ({ page }) => dialog({ page }).getByText('Public links', { exact: true }).locator('xpath=ancestor::*[.//*[text()="Nothing goes public"]][1]'),
        },
    ],
}
