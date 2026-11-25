import { body, visit } from '../steps.mjs'

export default {
    page: 'quickstart',
    watches: ['apps/ui/components/onboarding/', 'apps/ui/app/(authflow)/(onboarding)/welcome/', 'apps/ui/components/chat/', 'packages/i18n/messages/en/onboarding.json'],
    shots: [
        {
            name: 'line-of-work',
            account: 'onboarding',
            open: async ({ page, base, demo }) => {
                await demo.onboarding.setAnswers({})
                await visit(page, base, '/')
                await page.getByRole('button', { name: 'Agency', exact: true }).click()
            },
            ready: ({ page }) => page.getByText('Find your next clients'),
            frame: body,
        },
        {
            name: 'coworker-chat',
            view: 'simple',
            open: async ({ page, base, demo }) => {
                await visit(page, base, '/')
                await page.getByText(demo.coworkers.leadScout.name, { exact: true }).first().click()
            },
            ready: ({ page }) => page.getByText('Want me to draft the intro emails?'),
            frame: body,
        },
    ],
}
