import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { Composer } from './Composer'

type Listener = () => void
type FakeComposerModule = { listeners: Set<Listener>; addListener: (name: string, listener: Listener) => { remove: () => void } }

// Built inside the factory: `./Composer` is imported, and reads the module, before this file's own
// constants exist.
jest.mock('expo', () => {
    const actual = jest.requireActual('expo')
    const listeners = new Set<Listener>()
    const composerModule: FakeComposerModule = {
        listeners,
        addListener: (name, listener) => {
            if (name === 'onHardwareReturn') listeners.add(listener)
            return { remove: () => listeners.delete(listener) }
        },
    }
    return { ...actual, fakeComposerModule: composerModule, requireOptionalNativeModule: (name: string) => (name === 'ComposerPaste' ? composerModule : actual.requireOptionalNativeModule(name)) }
})

jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null, G: () => null, Circle: () => null, Rect: () => null }))

const mockComposerModule = jest.requireMock<{ fakeComposerModule: FakeComposerModule }>('expo').fakeComposerModule
const pressHardwareReturn = () => mockComposerModule.listeners.forEach(listener => listener())

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip

describeOnIos('Composer on an iPad hardware keyboard', () => {
    afterEach(() => mockComposerModule.listeners.clear())

    const renderComposer = async (value: string) => {
        const onSend = jest.fn()
        const onChangeText = jest.fn()
        await render(<Composer value={value} onChangeText={onChangeText} onSend={onSend} onStop={() => {}} running={false} placeholder="Message Pulse" skills={[{ slug: 'weekly-report', name: 'Weekly report', description: '' }]} mentionAgents={[{ id: 'pulse', name: 'Pulse', handle: 'pulse' }]} />)
        return { onSend, onChangeText }
    }

    it('sends the message on Return', async () => {
        const { onSend } = await renderComposer('Hello')
        await fireEvent(screen.getByTestId('composer-input'), 'focus')
        pressHardwareReturn()
        expect(onSend).toHaveBeenCalledTimes(1)
    })

    it('sends nothing from an empty composer', async () => {
        const { onSend } = await renderComposer('')
        await fireEvent(screen.getByTestId('composer-input'), 'focus')
        pressHardwareReturn()
        expect(onSend).not.toHaveBeenCalled()
    })

    it('leaves Return to the composer being typed in, not to its neighbours in the pager', async () => {
        const { onSend } = await renderComposer('Hello')
        pressHardwareReturn()
        expect(mockComposerModule.listeners.size).toBe(0)
        expect(onSend).not.toHaveBeenCalled()
    })

    it.each([
        ['/rep', '/weekly-report '],
        ['@pu', '@pulse '],
    ])('picks the first suggestion of the open menu on %s, as the web does, and sends nothing', async (typed, written) => {
        const { onSend, onChangeText } = await renderComposer(typed)
        await fireEvent(screen.getByTestId('composer-input'), 'focus')
        pressHardwareReturn()
        expect(onChangeText).toHaveBeenCalledWith(written)
        expect(onSend).not.toHaveBeenCalled()
    })

    it('sends a slash that matches no skill, the menu having nothing to pick', async () => {
        const { onSend, onChangeText } = await renderComposer('/zzz')
        await fireEvent(screen.getByTestId('composer-input'), 'focus')
        pressHardwareReturn()
        expect(onSend).toHaveBeenCalledTimes(1)
        expect(onChangeText).not.toHaveBeenCalled()
    })
})
