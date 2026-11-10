import { fireEvent, render, screen } from '@testing-library/react-native'

import { QuestionWidget } from './QuestionWidget'

jest.mock('@/lib/haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: null, me: null }) }))

const pending = (input: Record<string, unknown>) => ({ kind: 'question' as const, toolCallId: 'call-1', input, output: undefined })

async function setup(input: Record<string, unknown>) {
    const onAnswer = jest.fn()
    const onDismiss = jest.fn()
    await render(<QuestionWidget pending={pending(input)} agentId="a1" coworkerName="Scout" webUrl="" onAnswer={onAnswer} onDismiss={onDismiss} />)
    return { onAnswer, onDismiss }
}

describe('QuestionWidget', () => {
    it('answers a single choice at once, takes the next answer in its own field, and sends both as the web does', async () => {
        const { onAnswer } = await setup({
            questions: [
                { question: 'Which list?', options: ['Q4', 'Q1'] },
                { question: 'Anything to avoid?', options: [] },
            ],
        })
        await fireEvent.press(screen.getByLabelText('Q4'))
        expect(screen.getByLabelText('Previous step')).toBeEnabled()
        await fireEvent.changeText(screen.getAllByTestId('hitl-answer').at(-1)!, 'No cold calls')
        await fireEvent.press(screen.getByLabelText('Send'))
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which list?**\nQ4\n\n**Anything to avoid?**\nNo cold calls')
    })

    it('collects several choices before moving on, and sends a skipped question as skipped', async () => {
        const { onAnswer } = await setup({ questions: [{ question: 'Which channels?', options: ['LinkedIn', 'X', 'Instagram'], multiple: true }] })
        await fireEvent.press(screen.getByLabelText('LinkedIn'))
        await fireEvent.press(screen.getByLabelText('X'))
        expect(onAnswer).not.toHaveBeenCalled()
        await fireEvent.press(screen.getByLabelText('Send'))
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which channels?**\n- LinkedIn\n- X')
    })

    it('sends a skipped question as skipped, once, and closes on dismiss', async () => {
        const { onAnswer, onDismiss } = await setup({ questions: [{ question: 'Which list?', options: ['Q4'] }] })
        await fireEvent.press(screen.getByLabelText('Skip'))
        await fireEvent.press(screen.getByLabelText('Skip'))
        expect(onAnswer).toHaveBeenCalledTimes(1)
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which list?**\n[skipped]')
        await fireEvent.press(screen.getByLabelText('Dismiss questions'))
        expect(onDismiss).toHaveBeenCalled()
    })

    it('shows the header and each option description, and answers with the label alone', async () => {
        const { onAnswer } = await setup({
            v: 2,
            questions: [{ question: 'Which format?', header: 'Format', options: [{ label: 'One-pager', description: 'A single page with the key numbers' }, 'Deck'] }],
        })
        expect(screen.getByText('Format')).toBeTruthy()
        expect(screen.getByText('A single page with the key numbers')).toBeTruthy()
        await fireEvent.press(screen.getByLabelText('One-pager'))
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which format?**\nOne-pager')
    })

    it('takes "Something else" in place of the options', async () => {
        const { onAnswer } = await setup({ questions: [{ question: 'Which list?', options: ['Q4', 'Q1'] }] })
        expect(screen.queryByTestId('hitl-answer')).toBeNull()
        await fireEvent.press(screen.getByLabelText('Something else'))
        await fireEvent(screen.getByTestId('hitl-answer'), 'changeText', 'The Paris one')
        await fireEvent(screen.getByTestId('hitl-answer'), 'submitEditing')
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which list?**\nThe Paris one')
    })
})
