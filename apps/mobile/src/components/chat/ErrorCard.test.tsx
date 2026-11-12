import { fireEvent, render, screen } from '@testing-library/react-native'

import { ErrorCard } from './ErrorCard'

jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null }))

const SIGNED_OUT = 'claude 401: {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}'
const SESSION_LIMIT = "You've hit your session limit · resets 4pm"
const CREDITS = '402 Payment Required: {"error":"rerun_budget_exhausted"}'
const THINKING_REPLAY = 'ProviderRefusedError: Provider returned error: messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.'

const actions = () => ({ onRetry: jest.fn(), onReconnect: jest.fn(), onSwitchModel: jest.fn(), onConnect: jest.fn() })

describe('ErrorCard', () => {
    it('offers to sign in again rather than a retry that would be refused the same way', async () => {
        const handlers = actions()
        await render(<ErrorCard message={SIGNED_OUT} {...handlers} />)
        expect(screen.queryByText('Try again')).toBeNull()
        await fireEvent.press(screen.getByText('Reconnect'))
        expect(handlers.onReconnect).toHaveBeenCalled()
    })

    it('sends a spent plan to another model', async () => {
        const handlers = actions()
        await render(<ErrorCard message={SESSION_LIMIT} {...handlers} />)
        await fireEvent.press(screen.getByText('Switch model'))
        expect(handlers.onSwitchModel).toHaveBeenCalled()
    })

    it('answers used-up credits with the two plans and nothing to buy', async () => {
        const handlers = actions()
        await render(<ErrorCard message={CREDITS} {...handlers} />)
        await fireEvent.press(screen.getByText('Connect ChatGPT'))
        expect(handlers.onConnect).toHaveBeenCalledWith('codex')
        expect(screen.queryByText(/Top up|Subscribe/)).toBeNull()
    })

    it('says the plan credit comes after a store trial, and still sells nothing', async () => {
        await render(<ErrorCard message={CREDITS} {...actions()} storeTrial />)
        expect(screen.getByText("Your plan's monthly credit starts when the free trial ends.")).toBeTruthy()
        expect(screen.queryByText(/Top up|Subscribe/)).toBeNull()
    })

    it('retries a rejected thinking replay rather than sending it to another model', async () => {
        const handlers = actions()
        await render(<ErrorCard message={THINKING_REPLAY} {...handlers} />)
        expect(screen.getByText('The run could not continue')).toBeTruthy()
        expect(screen.queryByText('Switch model')).toBeNull()
        await fireEvent.press(screen.getByText('Try again'))
        expect(handlers.onRetry).toHaveBeenCalled()
    })

    it('falls back to Try again where the screen offers no fix', async () => {
        const onRetry = jest.fn()
        await render(<ErrorCard message={SIGNED_OUT} onRetry={onRetry} />)
        await fireEvent.press(screen.getByText('Try again'))
        expect(onRetry).toHaveBeenCalled()
    })
})
