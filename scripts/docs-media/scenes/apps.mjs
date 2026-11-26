import { openCoworker, panelAround } from '../steps.mjs'

export default {
    page: 'agents/apps',
    watches: ['apps/ui/components/agent/AgentPanelServices.tsx', 'apps/ui/components/agent/AppTiles.tsx', 'apps/ui/components/vault/CoworkerVaultSection.tsx', 'apps/ui/components/services/', 'packages/i18n/messages/en/agent.json', 'packages/i18n/messages/en/services.json'],
    shots: [
        {
            name: 'apps-tab',
            open: ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.leadScout, 'services'),
            ready: ({ page }) => page.getByRole('heading', { name: /^Vault/ }),
            frame: ({ page }) => panelAround(page, page.getByRole('heading', { name: /^Vault/ })),
        },
    ],
}
