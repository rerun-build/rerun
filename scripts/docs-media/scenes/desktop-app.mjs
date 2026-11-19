import { asDesktopApp, body, dialog, openWorkspaceMenu, visit } from '../steps.mjs'

// This computer, linked to the demo workspace: the panel only counts a link to the workspace it shows.
const studioMac = ({ base, demo }) => ({
    links: [{ computerId: '5c2e8f14-7a3b-4d6e-9f01-2b3c4d5e6f70', name: 'Studio Mac', handle: 'studio-mac', workspaceId: demo.workspaceId, workspaceName: 'Acme Studio', hubOrigin: new URL(base).origin, linkedAt: '2026-11-09T09:30:00.000Z', status: 'online' }],
    workDir: '/Users/studio/Rerun',
    machine: { hostname: 'studio-mac.local', os: 'mac', arch: 'arm64', suggestedName: 'Studio Mac' },
})

export default {
    page: 'desktop-app',
    watches: ['apps/ui/components/account/DesktopAppPanel.tsx', 'apps/ui/components/computers/ThisComputer.tsx', 'apps/ui/app/quick-ask/', 'packages/i18n/messages/en/desktopShell.json'],
    shots: [
        {
            name: 'desktop-settings',
            height: 1200,
            open: async ({ page, base, demo }) => {
                await asDesktopApp(page, { remote: studioMac({ base, demo }) })
                await openWorkspaceMenu(page, base)
                await page.getByRole('menuitem', { name: 'Account', exact: true }).click()
                await dialog({ page }).getByText('Desktop app', { exact: true }).click()
            },
            ready: ({ page }) => dialog({ page }).getByText('Open at login', { exact: true }),
            frame: dialog,
            fit: true,
        },
        {
            name: 'quick-ask',
            width: 680,
            height: 200,
            open: async ({ page, base }) => {
                await asDesktopApp(page)
                await visit(page, base, '/quick-ask')
                await page.getByRole('textbox').first().fill('Which invoices are still unpaid this month?')
            },
            ready: ({ page }) => page.locator('[data-quick-ask]'),
            frame: body,
        },
    ],
}
