import { fireEvent, render, screen } from '@testing-library/react-native'

import { ApprovalWidget } from './ApprovalWidget'

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))

const props = (kind: 'approval', input: Record<string, unknown>, output?: unknown) => ({ pending: { kind, toolCallId: 'call-1', input, output }, onAnswer: jest.fn(), onDismiss: jest.fn(), agentId: 'a1', coworkerName: 'Scout', webUrl: '' })

describe('ApprovalWidget', () => {
    it('sends every decision at once, written as the web writes them, once each item is decided', async () => {
        const approval = props('approval', { approvals: [{ action: 'Send the newsletter' }, { action: 'Delete old drafts' }] })
        await render(<ApprovalWidget {...approval} />)
        await fireEvent.press(screen.getByLabelText('Approve'))
        expect(approval.onAnswer).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Previous step')).toBeEnabled()
        await fireEvent.press(screen.getByLabelText('Not now'))
        expect(approval.onAnswer).not.toHaveBeenCalled()
        await fireEvent.changeText(screen.getByTestId('hitl-decline-reason'), 'Too early')
        await fireEvent.press(screen.getByLabelText('Confirm'))
        expect(approval.onAnswer).toHaveBeenCalledWith('Here are my approval decisions:\n\n1. **APPROVED** — Send the newsletter\n\n2. **DECLINED** — Delete old drafts\nReason: Too early\n\nPerform only the approved actions. Do not perform any declined action or attempt any workaround to achieve the same result.')
    })

    it('goes back from the reason without deciding', async () => {
        const approval = props('approval', { approvals: [{ action: 'Send the newsletter' }] })
        await render(<ApprovalWidget {...approval} />)
        await fireEvent.press(screen.getByLabelText('Not now'))
        await fireEvent.press(screen.getByLabelText('Back'))
        expect(screen.queryByTestId('hitl-decline-reason')).toBeNull()
        expect(approval.onAnswer).not.toHaveBeenCalled()
    })
})
