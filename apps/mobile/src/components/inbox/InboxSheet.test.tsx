import type { InboxItem } from '@rerun/contracts'
import { fireEvent, render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Alert } from 'react-native'

import { InboxSheet } from './InboxSheet'

const mockInbox = { state: 'ready' as const, items: [] as InboxItem[], running: 0, fresh: true, markRead: jest.fn(), clearAll: jest.fn(), reload: jest.fn() }

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }))
jest.mock('@/data/InboxProvider', () => ({ useInbox: () => mockInbox }))
jest.mock('@/data/useNotificationPrefs', () => ({ useNotificationPrefs: () => ({ ruleOf: () => undefined, setCoworkerRule: jest.fn() }) }))
jest.mock('@/components/inbox/InboxRow', () => ({ InboxRow: () => null }))
jest.mock('@/components/home/HomeSkeleton', () => ({ HomeSkeleton: () => null }))
jest.mock('@/components/ui/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/ui/GlassButton', () => {
    const { Text } = jest.requireActual('react-native')
    return { GLASS_BUTTON_SIZE: 44, GlassButton: ({ label, disabled }: { label: string; disabled?: boolean }) => <Text>{`${label}${disabled ? ' (disabled)' : ''}`}</Text> }
})
jest.mock('@/components/ui/NativeMenu', () => {
    const { Text } = jest.requireActual('react-native')
    const Pass = ({ children }: { children?: ReactNode }) => children ?? null
    return {
        NativeMenu: Pass,
        MenuSection: Pass,
        CircleTrigger: () => null,
        MenuItem: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => <Text onPress={onPress}>{`${label}${disabled ? ' (disabled)' : ''}`}</Text>,
    }
})

const item = (id: string, patch: Partial<InboxItem>): InboxItem => ({ id, sessionId: id, sessionIds: [id], agentId: 'a1', agentName: 'Scout', status: 'done', title: id, message: null, updatedAt: '2026-11-19T09:00:00Z', count: 1, ...patch })
const approval = item('approval', { status: 'awaiting_approval' })
const error = item('error', { status: 'error' })
const done = item('done', { count: 3 })

describe('the double choice of the inbox', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})

    beforeEach(() => {
        jest.clearAllMocks()
        mockInbox.fresh = true
    })

    it('marks what only informs, the request stays', async () => {
        mockInbox.items = [approval, error, done]
        await render(<InboxSheet />)
        await fireEvent.press(screen.getByText('Mark 4 notifications as read'))
        expect(mockInbox.markRead).toHaveBeenCalledWith([error, done])
        expect(mockInbox.clearAll).not.toHaveBeenCalled()
    })

    it('clears all only once confirmed', async () => {
        mockInbox.items = [approval, done]
        await render(<InboxSheet />)
        await fireEvent.press(screen.getByText('Clear all, including 1 request'))
        expect(mockInbox.clearAll).not.toHaveBeenCalled()
        const [title, message, buttons] = alert.mock.calls[0]
        expect(title).toBe('Clear all notifications?')
        expect(message).toContain('1 waiting request leaves the inbox without an answer')
        buttons?.find(button => button.style === 'destructive')?.onPress?.()
        expect(mockInbox.clearAll).toHaveBeenCalledTimes(1)
    })

    it('has nothing to mark when only requests are left', async () => {
        mockInbox.items = [approval]
        await render(<InboxSheet />)
        expect(screen.getByText('No notification to mark (disabled)')).toBeTruthy()
        expect(screen.getByText('Clear all, including 1 request')).toBeTruthy()
    })

    it('offers no clear all without a request', async () => {
        mockInbox.items = [done]
        await render(<InboxSheet />)
        expect(screen.getByText('Mark 3 notifications as read')).toBeTruthy()
        expect(screen.queryByText(/Clear all/)).toBeNull()
    })

    it('is off on an empty list and on the copy kept from the last visit', async () => {
        mockInbox.items = []
        await render(<InboxSheet />)
        expect(screen.getByText('Mark notifications as read (disabled)')).toBeTruthy()

        mockInbox.items = [done]
        mockInbox.fresh = false
        await screen.rerender(<InboxSheet />)
        expect(screen.getByText('Mark notifications as read (disabled)')).toBeTruthy()
    })
})
