import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ActionSheetIOS, Alert, Platform } from 'react-native'

import { promptText, showActionSheet, SystemDialogHost } from '@/components/ui/system-dialogs'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip
const describeOnIOS = Platform.OS === 'ios' ? describe : describe.skip

const SHEET = { title: 'Pick one', options: ['Mark as read', 'Mute Ada', 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndex: 1 }

describeOnAndroid('system dialogs on Android', () => {
    it('shows the action sheet without its cancel row, and answers the row tapped', async () => {
        const onSelect = jest.fn()
        await render(<SystemDialogHost />)
        await act(async () => showActionSheet(SHEET, onSelect))

        expect(screen.getByText('Pick one')).toBeTruthy()
        expect(screen.queryByText('Cancel')).toBeNull()
        await fireEvent.press(screen.getByText('Mute Ada'))

        expect(onSelect).toHaveBeenCalledWith(1)
        expect(screen.queryByText('Mark as read')).toBeNull()
    })

    it('scrolls a long list inside the sheet instead of running off the screen', async () => {
        const options = [...Array.from({ length: 40 }, (_, index) => `Coworker ${index + 1}`), 'Cancel']
        await render(<SystemDialogHost />)
        await act(async () => showActionSheet({ options, cancelButtonIndex: 40 }, () => {}))
        const list = screen.getByTestId('action-sheet-rows')
        expect(list.type).toBe('RCTScrollView')
        expect(list.props.style).toMatchObject({ maxHeight: expect.any(Number) })
    })

    it('answers the cancel index when the sheet is dismissed', async () => {
        const onSelect = jest.fn()
        await render(<SystemDialogHost />)
        await act(async () => showActionSheet(SHEET, onSelect))
        await fireEvent.press(screen.getByTestId('action-sheet-backdrop'))
        expect(onSelect).toHaveBeenCalledWith(2)
    })

    it('prompts for text starting from the default value and submits what was typed', async () => {
        const onSubmit = jest.fn()
        const onCancel = jest.fn()
        await render(<SystemDialogHost />)
        await act(async () => promptText({ title: 'Rename', defaultValue: 'Ada', cancelLabel: 'Cancel', submitLabel: 'Save', onSubmit, onCancel }))

        expect(screen.getByTestId('prompt-input').props.value).toBe('Ada')
        await fireEvent.changeText(screen.getByTestId('prompt-input'), 'Grace')
        await fireEvent.press(screen.getByText('Save'))

        expect(onSubmit).toHaveBeenCalledWith('Grace')
        expect(onCancel).not.toHaveBeenCalled()
        expect(screen.queryByTestId('prompt-input')).toBeNull()
    })

    it('calls onCancel when the prompt is dismissed', async () => {
        const onSubmit = jest.fn()
        const onCancel = jest.fn()
        await render(<SystemDialogHost />)
        await act(async () => promptText({ title: 'Rename', onSubmit, onCancel }))
        await fireEvent.press(screen.getByTestId('prompt-backdrop'))

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('opens a fresh prompt each time, without the text typed in the last one', async () => {
        await render(<SystemDialogHost />)
        await act(async () => promptText({ title: 'Rename', defaultValue: 'Ada', onSubmit: () => {} }))
        await fireEvent.changeText(screen.getByTestId('prompt-input'), 'typed')
        await fireEvent.press(screen.getByTestId('prompt-backdrop'))
        await act(async () => promptText({ title: 'Rename', defaultValue: 'Ada', onSubmit: () => {} }))
        expect(screen.getByTestId('prompt-input').props.value).toBe('Ada')
    })
})

describeOnIOS('system dialogs on iOS', () => {
    afterEach(() => jest.restoreAllMocks())

    it('hands the action sheet to the system', () => {
        const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {})
        const onSelect = jest.fn()
        showActionSheet(SHEET, onSelect)
        expect(show).toHaveBeenCalledWith(SHEET, onSelect)
    })

    it('hands the prompt to Alert.prompt, with the labels given', () => {
        const prompt = jest.spyOn(Alert, 'prompt').mockImplementation(() => {})
        const onSubmit = jest.fn()
        promptText({ title: 'Rename', defaultValue: 'Ada', cancelLabel: 'Cancel', submitLabel: 'Save', onSubmit })
        const [title, message, buttons, type, defaultValue] = prompt.mock.calls[0]
        expect([title, message, type, defaultValue]).toEqual(['Rename', undefined, 'plain-text', 'Ada'])
        const save = (buttons as { text: string; onPress: (text?: string) => void }[])[1]
        expect(save.text).toBe('Save')
        save.onPress('Grace')
        expect(onSubmit).toHaveBeenCalledWith('Grace')
    })

    it('mounts nothing', async () => {
        await render(<SystemDialogHost />)
        expect(screen.toJSON()).toBeNull()
    })
})
