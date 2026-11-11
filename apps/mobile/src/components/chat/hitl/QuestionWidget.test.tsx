import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import type { ComposerAttachment } from '../attachments'
import { QuestionWidget } from './QuestionWidget'

jest.mock('@/lib/haptics', () => ({ selectionAsync: jest.fn(), impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' } }))
jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: null, me: null }) }))

// The attach menu is a SwiftUI host, which Jest cannot mount: its rows are drawn as plain buttons so
// the pick, the upload and the path the message names are exercised for real.
jest.mock('@/components/ui/NativeMenu', () => {
    const React = require('react')
    const { Pressable, View } = require('react-native')
    return {
        NativeMenu: ({ trigger, children }: { trigger: unknown; children: unknown }) => React.createElement(View, null, trigger, children),
        MenuItem: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement(Pressable, { accessibilityLabel: label, accessibilityRole: 'button', onPress }),
        MenuToggle: () => null,
        MenuSection: ({ children }: { children: unknown }) => children,
        SubMenu: ({ children }: { children: unknown }) => children,
    }
})

jest.mock('expo-document-picker', () => ({
    getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///skill.zip', name: 'skill.zip', mimeType: 'application/zip', size: 2048 }] })),
}))

jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
    launchCameraAsync: jest.fn(async () => ({ canceled: true })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: false })),
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}))

const pending = (input: Record<string, unknown>) => ({ kind: 'question' as const, toolCallId: 'call-1', input, output: undefined })

type AnswerTools = { upload?: (attachment: ComposerAttachment) => Promise<string>; transcribe?: (uri: string) => Promise<string> }

async function setup(input: Record<string, unknown>, tools: AnswerTools = {}) {
    const onAnswer = jest.fn()
    const onDismiss = jest.fn()
    await render(<QuestionWidget pending={pending(input)} agentId="a1" coworkerName="Scout" webUrl="" onAnswer={onAnswer} onDismiss={onDismiss} {...tools} />)
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

    it('draws neither the paperclip nor the microphone when the conversation cannot carry them', async () => {
        await setup({ questions: [{ question: 'Which list?', options: [] }] })
        expect(screen.queryByLabelText('Attach')).toBeNull()
        expect(screen.queryByLabelText('Answer with your voice')).toBeNull()
    })

    it('attaches a file to the answer, uploads it, and names its path in the message', async () => {
        const upload = jest.fn(async () => 'chat-uploads/mtr4k52x-lBg1lF-skill.zip')
        const { onAnswer } = await setup({ questions: [{ question: 'Which folder?', options: [] }] }, { upload })
        await fireEvent.press(screen.getByLabelText('Files'))
        await waitFor(() => expect(screen.getByText('skill.zip')).toBeTruthy())
        await fireEvent.press(screen.getByLabelText('Send'))
        await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**Which folder?**\nAttached: skill.zip\n\n[Attachments added to your workspace: chat-uploads/mtr4k52x-lBg1lF-skill.zip]'))
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({ name: 'skill.zip' }))
    })

    it('puts the paperclip and the microphone to rest while the files are on their way out', async () => {
        const upload = jest.fn(() => new Promise<string>(() => {}))
        const transcribe = jest.fn(async () => '')
        await setup({ questions: [{ question: 'Which folder?', options: [] }] }, { upload, transcribe })
        await fireEvent.press(screen.getByLabelText('Files'))
        await waitFor(() => expect(screen.getByText('skill.zip')).toBeTruthy())
        await fireEvent.press(screen.getByLabelText('Send'))
        await waitFor(() => expect(screen.getByLabelText('Answer with your voice')).toBeDisabled())
        expect(screen.getByLabelText('Attach')).toBeDisabled()
        expect(screen.getByLabelText('Send')).toBeDisabled()
        expect(upload).toHaveBeenCalledTimes(1)
    })

    it('adds what was dictated to what was already typed', async () => {
        const transcribe = jest.fn(async () => 'and the three replies at its root')
        const { onAnswer } = await setup({ questions: [{ question: 'What is in it?', options: [] }] }, { transcribe })
        await fireEvent.changeText(screen.getByTestId('hitl-answer'), 'The zip is the whole folder')
        await fireEvent.press(screen.getByLabelText('Answer with your voice'))
        await waitFor(() => expect(screen.getByLabelText('Use this recording')).toBeTruthy())
        await fireEvent.press(screen.getByLabelText('Use this recording'))
        await waitFor(() => expect(screen.getByTestId('hitl-answer')).toHaveProp('value', 'The zip is the whole folder and the three replies at its root'))
        await fireEvent.press(screen.getByLabelText('Send'))
        expect(onAnswer).toHaveBeenCalledWith('Here are my answers:\n\n**What is in it?**\nThe zip is the whole folder and the three replies at its root')
        expect(transcribe).toHaveBeenCalledWith('file:///recording.m4a')
    })
})
