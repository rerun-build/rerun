import { openCoworker, panelAround } from '../steps.mjs'

const openSkills = async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.leadScout, 'skills')

export default {
    page: 'agents/skills',
    watches: ['apps/ui/components/agent/skills/', 'packages/i18n/messages/en/agent.json'],
    shots: [
        {
            name: 'skills-tab',
            open: openSkills,
            ready: ({ page }) => page.getByText('qualify-a-lead', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('qualify-a-lead', { exact: true })),
            height: 420,
        },
        {
            name: 'skill-editor',
            open: async (ctx) => {
                await openSkills(ctx)
                await ctx.page.getByText('qualify-a-lead', { exact: true }).first().click()
            },
            ready: ({ page }) => page.getByText('Procedure', { exact: true }),
            frame: ({ page }) => panelAround(page, page.getByText('Procedure', { exact: true })),
            height: 760,
        },
    ],
}
