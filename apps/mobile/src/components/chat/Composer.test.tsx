import { fireEvent, render, screen } from '@testing-library/react-native'
import type { ComponentProps } from 'react'
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

// iOS draws no glass on a view set up off screen (a page of the pager beside the one shown): the glass is
// laid again when the composer comes on screen, and only then.
describeOnIos('the composer glass', () => {
    const composer = (value: string, onScreen: boolean) => <Composer value={value} onChangeText={() => {}} onSend={() => {}} onStop={() => {}} running={false} placeholder="Message Pulse" onScreen={onScreen} />

    it('is laid again when its page comes on screen', async () => {
        const { rerender } = await render(composer('', false))
        const offScreen = screen.getByTestId('composer-glass')
        await rerender(composer('', true))
        expect(screen.getByTestId('composer-glass')).not.toBe(offScreen)
    })

    it('stays the same while someone types or the page stays on screen', async () => {
        const { rerender } = await render(composer('', true))
        const glass = screen.getByTestId('composer-glass')
        await rerender(composer('Hello', true))
        expect(screen.getByTestId('composer-glass')).toBe(glass)
    })
})

describeOnIos('Composer mention menu', () => {
    const renderComposer = async (value: string, props: Partial<ComponentProps<typeof Composer>> = {}) => {
        await render(<Composer value={value} onChangeText={() => {}} onSend={() => {}} onStop={() => {}} running={false} placeholder="Message Pulse" mentionAgents={[{ id: 'pulse', name: 'Pulse', handle: 'pulse' }]} skills={[]} {...props} />)
        await fireEvent(screen.getByTestId('composer-input'), 'focus')
    }

    it('says what a symbol does above its suggestions', async () => {
        await renderComposer('@')
        expect(screen.getByText('Bring a coworker into this conversation')).toBeTruthy()
        expect(screen.getByText('Pulse')).toBeTruthy()
    })

    it('says so when a bare symbol has nothing to offer', async () => {
        await renderComposer('/')
        expect(screen.getByText('Run a saved how-to your coworker knows')).toBeTruthy()
        expect(screen.getByText('This coworker has no skill yet')).toBeTruthy()
    })

    it('stays shut on a hashtag that names no computer', async () => {
        await renderComposer('#marketing')
        expect(screen.queryByText('Let your coworker work on a linked computer')).toBeNull()
    })

    it('does not claim there is no skill while the list is not read', async () => {
        await renderComposer('/', { skills: null })
        expect(screen.getByText('Run a saved how-to your coworker knows')).toBeTruthy()
        expect(screen.queryByText('This coworker has no skill yet')).toBeNull()
    })

    it('leaves / as plain text in a composer without skills, like the Chief of Staff', async () => {
        await renderComposer('/', { triggers: ['@', '#'] })
        expect(screen.queryByText('Run a saved how-to your coworker knows')).toBeNull()
    })
})
