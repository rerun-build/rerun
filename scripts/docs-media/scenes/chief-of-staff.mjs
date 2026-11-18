import { body, showWholeBoard, visit } from '../steps.mjs'

export default {
    page: 'chief-of-staff',
    watches: ['apps/ui/components/foreman/', 'apps/ui/components/workspace-view/', 'packages/i18n/messages/en/foreman.json'],
    shots: [
        {
            name: 'chat-column',
            open: async ({ page, base }) => {
                await visit(page, base, '/')
                await showWholeBoard(page)
            },
            ready: ({ page }) => page.getByText('Which one should I set up first?'),
            frame: body,
        },
        {
            name: 'simple-view',
            view: 'simple',
            open: async ({ page, base }) => visit(page, base, '/'),
            ready: ({ page }) => page.getByText('Which one should I set up first?'),
            frame: body,
        },
    ],
}
