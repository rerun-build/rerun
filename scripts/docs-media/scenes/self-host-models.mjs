import { dialog, openWorkspaceMenu } from '../steps.mjs'

const openProviders = async ({ page, base }) => {
    await openWorkspaceMenu(page, base)
    await page.getByRole('menuitem', { name: 'AI providers', exact: true }).click()
}

export default {
    page: 'self-host/models',
    watches: ['apps/ui/components/dialogs/AiProvidersDialog.tsx', 'apps/ui/components/connections/', 'packages/i18n/messages/en/connections.json'],
    shots: [
        {
            name: 'your-api-keys',
            open: openProviders,
            ready: ({ page }) => dialog({ page }).getByText('Custom endpoint', { exact: true }),
            frame: ({ page }) => dialog({ page }).getByText('Your API keys', { exact: true }).locator('xpath=ancestor::*[.//*[text()="Custom endpoint"]][1]'),
        },
        {
            name: 'custom-endpoint',
            open: async (ctx) => {
                await openProviders(ctx)
                await dialog(ctx).getByText('Custom endpoint', { exact: true }).click()
            },
            ready: ({ page }) => dialog({ page }).getByText('Base URL', { exact: true }),
            frame: dialog,
            fit: true,
        },
    ],
}
