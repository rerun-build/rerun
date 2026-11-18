import { dialog, openWorkspaceMenu } from '../steps.mjs'

export default {
    page: 'brain',
    watches: ['apps/ui/components/brain/', 'apps/ui/components/dialogs/KnowledgeBaseDialog.tsx', 'packages/i18n/messages/en/brain.json'],
    shots: [
        {
            name: 'brain-page',
            open: async ({ page, base }) => {
                await openWorkspaceMenu(page, base)
                await page.getByRole('menuitem', { name: 'Brain', exact: true }).click()
            },
            ready: ({ page }) => dialog({ page }).getByText('Who we sell to'),
            frame: dialog,
        },
    ],
}
