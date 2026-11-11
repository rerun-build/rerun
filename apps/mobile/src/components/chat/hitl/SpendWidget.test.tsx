import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { setPaidDataAlwaysAllow } from '@/api/paid-data'

import { SpendWidget } from './SpendWidget'

jest.mock('@/lib/haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('@/components/ui/BorderBeam', () => ({ BorderBeam: () => null }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { workspace: { id: 7 } } }) }))
jest.mock('@/api/paid-data', () => ({ setPaidDataAlwaysAllow: jest.fn().mockResolvedValue(undefined) }))

const PURPOSE = 'Find the work emails of 40 restaurant owners'
const quote = (creditLeftMicros: number) => ({ status: 'delivered', quote: { totalMicros: 1_200_000, lines: [{ capability: 'people.email.find', count: 40, units: 40, micros: 1_200_000 }], creditLeftMicros } })

const props = (output: unknown) => ({ pending: { kind: 'spend' as const, toolCallId: 'call-1', input: { purpose: PURPOSE, calls: [{ capability: 'people.email.find', count: 40 }] }, output }, onAnswer: jest.fn(), onDismiss: jest.fn(), agentId: 'a1', coworkerName: 'Scout', webUrl: 'https://app.test/c/1' })

describe('SpendWidget', () => {
    beforeEach(() => jest.clearAllMocks())

    it('declines in one tap, with no reason to give', async () => {
        const spend = props(quote(5_000_000))
        await render(<SpendWidget {...spend} />)
        await fireEvent.press(screen.getByLabelText('Not now'))
        expect(spend.onAnswer).toHaveBeenCalledWith(`Spend decision: **DECLINED** — ${PURPOSE}\n\nDo not call any paid data tool for this. Go on with the free tools if they can do part of it, or ask me what to change.`)
        expect(screen.queryByTestId('hitl-decline-reason')).toBeNull()
    })

    it('approves once without touching the coworker', async () => {
        const spend = props(quote(5_000_000))
        await render(<SpendWidget {...spend} />)
        await fireEvent.press(screen.getByLabelText('Approve once'))
        expect(spend.onAnswer.mock.calls[0][0]).toMatch(/^Spend decision: \*\*APPROVED\*\* — /)
        expect(setPaidDataAlwaysAllow).not.toHaveBeenCalled()
    })

    it('writes "Always allow" onto the coworker before answering', async () => {
        const spend = props(quote(5_000_000))
        await render(<SpendWidget {...spend} />)
        await fireEvent.press(screen.getByLabelText('Always allow'))
        await waitFor(() => expect(spend.onAnswer).toHaveBeenCalled())
        expect(setPaidDataAlwaysAllow).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 'a1', true)
        expect(spend.onAnswer.mock.calls[0][0]).toContain('Always allowed: paid data tools no longer ask for this coworker.')
    })

    it('offers to add credits instead of approving a spend the workspace cannot pay', async () => {
        await render(<SpendWidget {...props(quote(300_000))} />)
        expect(screen.getByLabelText('Add credits')).toBeTruthy()
        expect(screen.queryByLabelText('Approve once')).toBeNull()
    })

    it('draws nothing for a request the hub could not price', async () => {
        await render(<SpendWidget {...props(undefined)} />)
        expect(screen.queryByLabelText('Not now')).toBeNull()
    })
})
