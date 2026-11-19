import { openCoworker, panelAround } from '../steps.mjs'

export default {
    page: 'self-host/services',
    watches: ['apps/ui/components/agent/AgentPanelMcp.tsx', 'apps/ui/components/agent/McpServerEditor.tsx', 'packages/i18n/messages/en/agent.json'],
    shots: [
        {
            name: 'mcp-server-editor',
            open: async ({ page, base, demo }) => {
                await openCoworker(page, base, demo.coworkers.leadScout, 'mcp')
                await page.getByRole('button', { name: 'New', exact: true }).first().click()
            },
            ready: ({ page }) => page.getByText('Transport', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Transport', { exact: true })),
            height: 780,
        },
    ],
}
