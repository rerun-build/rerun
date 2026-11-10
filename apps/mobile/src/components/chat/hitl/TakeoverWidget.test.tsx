import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { handBack } from '@/desktop/hand-back'
import { takePendingDesktopOpen } from '@/desktop/pending-open'
import { keyScript, mirrorScript, typeScript, viewerUrl } from '@/desktop/viewer'

import { TakeoverWidget } from './TakeoverWidget'

jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('@/config/environment', () => ({ environment: { apiUrl: 'https://hub.test' } }))
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { workspace: { id: 1 } } }) }))
const mockOpenDesktop = jest.fn(() => new Promise(() => {}))
const mockFinishTakeover = jest.fn(async (..._args: unknown[]) => ({ url: 'https://mail.google.com/inbox', open: true }))
jest.mock('@/api/desktop', () => ({ openDesktop: () => mockOpenDesktop(), finishTakeover: (...args: unknown[]) => mockFinishTakeover(...args) }))
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }))

const props = () => ({ pending: { kind: 'takeover' as const, toolCallId: 'call-7', input: { url: 'https://accounts.google.com/signin', reason: 'Sign in to Google for me' }, output: undefined }, agentId: 'a1', coworkerName: 'Scout', webUrl: '', onAnswer: jest.fn(), onDismiss: jest.fn() })

describe('TakeoverWidget', () => {
    it('opens the screen on the page asked, and answers with where the browser was left once handed back', async () => {
        const takeover = props()
        await render(<TakeoverWidget {...takeover} />)
        expect(screen.getByText('Opens accounts.google.com in your coworker’s browser, for you to drive.')).toBeTruthy()
        await fireEvent.press(screen.getByLabelText('Open browser'))
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/desktop', params: { agent: 'a1' } })
        expect(takePendingDesktopOpen('a1')).toEqual({ agentId: 'a1', name: 'Scout', call: 'call-7', url: 'https://accounts.google.com/signin' })
        await act(async () => handBack('call-7', { url: 'https://mail.google.com/', open: true }))
        expect(takeover.onAnswer.mock.calls[0][0]).toContain('https://mail.google.com/')
    })

    it('hands the browser back from the thread too, and answers only once', async () => {
        const takeover = props()
        await render(<TakeoverWidget {...takeover} />)
        await fireEvent.press(screen.getByLabelText('Open browser'))
        await fireEvent.press(screen.getByLabelText('Done'))
        await act(async () => handBack('call-7', { url: 'https://mail.google.com/', open: true }))
        expect(takeover.onAnswer).toHaveBeenCalledTimes(1)
        expect(takeover.onAnswer.mock.calls[0][0]).toContain('https://mail.google.com/inbox')
        expect(takeover.onAnswer.mock.calls[0][0]).toContain('The window is still open on your screen')
        expect(mockFinishTakeover).toHaveBeenCalledWith(expect.anything(), 'a1', { keepOpen: true })
    })

    it('opens the browser again where it was left, not on the page first asked', async () => {
        await render(<TakeoverWidget {...props()} />)
        await fireEvent.press(screen.getByLabelText('Open browser'))
        takePendingDesktopOpen('a1')
        await fireEvent.press(screen.getByLabelText('Open again'))
        expect(takePendingDesktopOpen('a1')).toEqual({ agentId: 'a1', name: 'Scout', call: 'call-7', url: undefined })
    })

    it('declines in the words the coworker reads', async () => {
        const takeover = props()
        await render(<TakeoverWidget {...takeover} />)
        await fireEvent.press(screen.getByLabelText('Skip'))
        expect(takeover.onAnswer).toHaveBeenCalledWith('[User declined to take over the browser]')
    })
})

describe('desktop viewer', () => {
    it('keeps the socket out of every request, in the fragment', () => {
        expect(viewerUrl('wss://relay/box/30/desktop/ws?ticket=a.b', 'drive')).toBe('https://hub.test/desktop-view#socket=wss%3A%2F%2Frelay%2Fbox%2F30%2Fdesktop%2Fws%3Fticket%3Da.b&mode=drive')
    })

    it('types any text safely into the page', () => {
        expect(typeScript('it\'s "quoted"\n')).toBe('window.rerunDesktop && window.rerunDesktop.type("it\'s \\"quoted\\"\\n"); true;')
        expect(keyScript(0xff0d, 'Enter')).toBe('window.rerunDesktop && window.rerunDesktop.key(65293, "Enter"); true;')
    })

    it('asks an older viewer page for nothing it does not have', () => {
        expect(mirrorScript(480)).toBe('window.rerunDesktop && window.rerunDesktop.mirror && window.rerunDesktop.mirror(true, 480); true;')
        expect(mirrorScript(null)).toBe('window.rerunDesktop && window.rerunDesktop.mirror && window.rerunDesktop.mirror(false, 0); true;')
    })
})
