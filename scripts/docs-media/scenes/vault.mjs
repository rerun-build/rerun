import { dialog, openWorkspaceMenu } from '../steps.mjs'


const invoiceChaserSwitch = ({ page }) =>
    dialog({ page }).getByText('Invoice Chaser', { exact: true }).locator('xpath=ancestor::*[.//button[@role="switch"]][1]').getByRole('switch')

const openVault = async ({ page, base }) => {
    await openWorkspaceMenu(page, base)
    await page.getByRole('menuitem', { name: 'Vault', exact: true }).click()
}

export default {
    page: 'vault',
    watches: ['apps/ui/components/vault/', 'packages/i18n/messages/en/vault.json'],
    shots: [
        {
            name: 'vault-list',
            open: openVault,
            ready: ({ page }) => dialog({ page }).getByText('Gmail', { exact: true }),
            frame: dialog,
            fit: true,
        },
    ],
    loops: [
        {
            name: 'vault-share-entry',
            // The light pass leaves Invoice Chaser switched on: the dark pass starts from off again.
            open: async (ctx) => {
                await openVault(ctx)
                await dialog(ctx).getByText('Gmail', { exact: true }).click()
                const finance = dialog(ctx).getByRole('button', { name: /^Finance/ })
                if ((await finance.getAttribute('aria-expanded')) === 'false') await finance.click()
                const toggle = invoiceChaserSwitch(ctx)
                await toggle.waitFor()
                if ((await toggle.getAttribute('aria-checked')) === 'true') {
                    await toggle.click()
                    await ctx.page.waitForTimeout(1500)
                }
            },
            ready: ({ page }) => dialog({ page }).getByText('Invoice Chaser', { exact: true }),
            frame: dialog,
            fit: true,
            play: async (ctx) => {
                await ctx.page.waitForTimeout(700)
                await invoiceChaserSwitch(ctx).click()
                await ctx.page.waitForTimeout(1200)
            },
        },
    ],
}
