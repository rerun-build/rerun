import { openCoworker, panelAround } from '../steps.mjs'

const approvalBlock = ({ page }) => page.getByText('Approval required', { exact: true }).locator('xpath=ancestor::div[.//button[@data-hitl="approve"]][1]')

export default {
    page: 'agents/human-in-the-loop',
    watches: ['packages/ui/src/chat/ActionApprovalBlock.tsx', 'apps/ui/components/chat/', 'packages/contracts/src/chat-hitl.ts', 'packages/i18n/messages/en/kit.json'],
    shots: [
        {
            name: 'approval-card',
            open: async ({ page, base, demo }) => openCoworker(page, base, demo.coworkers.invoiceChaser),
            ready: approvalBlock,
            frame: approvalBlock,
        },
    ],
    loops: [
        {
            name: 'approve-action',
            // The answer would start a run on a model: the request is held, the loop shows the card
            // taking the decision.
            open: async ({ page, base, demo }) => {
                await page.route('**/api/chat**', () => {})
                await openCoworker(page, base, demo.coworkers.invoiceChaser)
            },
            ready: approvalBlock,
            frame: ({ page }) => panelAround(page, page.getByText('Approval required', { exact: true })),
            play: async ({ page }) => {
                await page.waitForTimeout(800)
                await page.locator('[data-hitl="approve"]').click()
                await page.waitForTimeout(1500)
            },
        },
    ],
}
