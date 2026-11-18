import { dialog, visit } from '../steps.mjs'

export default {
    page: 'teams',
    watches: ['apps/ui/components/dialogs/WorkspaceMembersDialog.tsx', 'packages/i18n/messages/en/dialogs.json'],
    shots: [
        {
            name: 'members',
            open: async ({ page, base }) => visit(page, base, '/?members=1'),
            ready: ({ page }) => dialog({ page }).getByText('Invite by email'),
            frame: dialog,
            fit: true,
        },
    ],
}
