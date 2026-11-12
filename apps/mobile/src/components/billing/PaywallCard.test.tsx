import { fireEvent, render, screen } from '@testing-library/react-native'
import * as WebBrowser from 'expo-web-browser'

import type { PaywallNotice, PaywallState } from '@/store/usePaywall'

import { PRIVACY_URL, PaywallCard, TERMS_URL } from './PaywallCard'

jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Svg: () => null, Path: () => null, Circle: () => null, Defs: () => null, RadialGradient: () => null, LinearGradient: () => null, Stop: () => null, G: () => null, Ellipse: () => null, Rect: () => null }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => {}) }))

const PRODUCT = { productId: 'rerun.base.monthly', displayPrice: '29,99 €', trialDays: 7, offerToken: null }
const handlers = () => ({ onBuy: jest.fn(), onRestore: jest.fn(), onRetry: jest.fn() })
const ready = (patch: { product?: typeof PRODUCT | (Omit<typeof PRODUCT, 'trialDays'> & { trialDays: number | null }); notice?: PaywallNotice } = {}): PaywallState => ({ step: 'ready', product: PRODUCT, notice: null, ...patch })

describe('PaywallCard', () => {
    it('states the free week, the store price, the renewal, the terms and Restore purchases, as App Review asks', async () => {
        const actions = handlers()
        await render(<PaywallCard state={ready()} provider="apple" {...actions} />)
        expect(screen.getByText('Try Rerun free for 7 days')).toBeTruthy()
        expect(screen.getByText('Then 29,99 € a month. Cancel anytime.')).toBeTruthy()
        expect(screen.getByText(/Renews automatically every month at 29,99 € until you cancel, at least 24 hours before the period ends, in your Apple Account subscriptions/)).toBeTruthy()
        await fireEvent.press(screen.getByText('Start free trial'))
        expect(actions.onBuy).toHaveBeenCalled()
        await fireEvent.press(screen.getByText('Restore purchases'))
        expect(actions.onRestore).toHaveBeenCalled()
        await fireEvent.press(screen.getByText('Terms'))
        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(TERMS_URL)
        await fireEvent.press(screen.getByText('Privacy'))
        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(PRIVACY_URL)
    })

    it('sells the plan without the week once the account has spent it, with Google Play wording', async () => {
        await render(<PaywallCard state={ready({ product: { ...PRODUCT, displayPrice: '$29.99', trialDays: null } })} provider="google" {...handlers()} />)
        expect(screen.getByText('Start your Rerun plan')).toBeTruthy()
        expect(screen.getByText('$29.99 a month. Cancel anytime.')).toBeTruthy()
        expect(screen.getByText('Subscribe')).toBeTruthy()
        expect(screen.getByText(/in your Google Play subscriptions/)).toBeTruthy()
        expect(screen.queryByText(/free/i)).toBeNull()
    })

    it('says why a purchase did not go through, and offers Try again after a failure', async () => {
        const actions = handlers()
        const { rerender } = await render(<PaywallCard state={ready({ notice: 'linked_elsewhere' })} provider="apple" {...actions} />)
        expect(screen.getByText('This subscription already runs another workspace.')).toBeTruthy()
        await rerender(<PaywallCard state={ready({ notice: 'failed' })} provider="apple" {...actions} />)
        await fireEvent.press(screen.getByText('Try again'))
        expect(actions.onRetry).toHaveBeenCalled()
        await rerender(<PaywallCard state={ready({ notice: 'cancelled' })} provider="apple" {...actions} />)
        expect(screen.getByText('Start free trial')).toBeTruthy()
        expect(screen.queryByText(/did not go through/)).toBeNull()
    })

    it('waits on the hub without a second tap', async () => {
        const actions = handlers()
        await render(<PaywallCard state={{ step: 'verifying', product: PRODUCT, notice: null }} provider="apple" {...actions} />)
        await fireEvent.press(screen.getByText('Restore purchases'))
        expect(actions.onRestore).not.toHaveBeenCalled()
    })

    it('tells a member to ask an admin, and offers a retry when the store has nothing to show', async () => {
        const actions = handlers()
        const { rerender } = await render(<PaywallCard state={{ step: 'unavailable', reason: 'member' }} provider="apple" {...actions} />)
        expect(screen.getByText('Ask an admin of this workspace to start the plan.')).toBeTruthy()
        expect(screen.queryByText('Try again')).toBeNull()
        await rerender(<PaywallCard state={{ step: 'unavailable', reason: 'no_product' }} provider="apple" {...actions} />)
        await fireEvent.press(screen.getByText('Try again'))
        expect(actions.onRetry).toHaveBeenCalled()
    })
})
