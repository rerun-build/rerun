import { dialog, openWorkspaceMenu } from '../steps.mjs'

const openComputers = async ({ page, base }) => {
    await openWorkspaceMenu(page, base)
    await page.getByRole('menuitem', { name: 'Computers', exact: true }).click()
}

export default {
    page: 'computers',
    watches: ['apps/ui/components/computers/', 'packages/i18n/messages/en/computers.json'],
    shots: [
        {
            name: 'computers-list',
            open: openComputers,
            ready: ({ page }) => dialog({ page }).getByText('Studio Mac', { exact: true }),
            frame: dialog,
            fit: true,
        },
        {
            name: 'computer-detail',
            open: async (ctx) => {
                await openComputers(ctx)
                await dialog(ctx).getByText('Studio Mac', { exact: true }).click()
            },
            ready: ({ page }) => dialog({ page }).getByText('Ask, then remember', { exact: true }),
            frame: dialog,
            fit: true,
        },
    ],
}
