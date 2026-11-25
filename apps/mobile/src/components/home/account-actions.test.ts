import * as WebBrowser from 'expo-web-browser'

import { contactSupport, initialsOf } from '@/components/home/account-actions'

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

const openedUrl = () => new URL((WebBrowser.openBrowserAsync as jest.Mock).mock.calls.at(-1)[0])

describe('initialsOf', () => {
    it('takes the first letters of the first two words of the name', () => {
        expect(initialsOf({ id: 'u', email: null, name: 'ada lovelace byron', avatarUrl: null })).toBe('AL')
    })

    it('falls back on the email, and on nothing for an account born from a phone number', () => {
        expect(initialsOf({ id: 'u', email: 'grace@example.com', name: null, avatarUrl: null })).toBe('G')
        expect(initialsOf({ id: 'u', email: null, name: null, avatarUrl: null })).toBeNull()
    })
})

describe('contactSupport', () => {
    it('opens the conversation of the account, the one it has on the web', () => {
        contactSupport({ id: 'u', email: 'ada@example.com', name: null, avatarUrl: null, supportChatToken: '0b6c1f3e-5a2d-4c8e-9f17-3d2a6b8e4c51' })
        expect(openedUrl().searchParams.get('token_id')).toBe('0b6c1f3e-5a2d-4c8e-9f17-3d2a6b8e4c51')
        expect(openedUrl().searchParams.get('user_email')).toBe('ada@example.com')
        expect(openedUrl().searchParams.has('session_merge')).toBe(false)
    })

    it('opens the chat as before on a hub that sends no key', () => {
        contactSupport({ id: 'u', email: 'ada@example.com', name: null, avatarUrl: null })
        expect(openedUrl().searchParams.has('token_id')).toBe(false)
        expect(openedUrl().searchParams.get('website_id')).toBe('fa9be3a1-b3f1-4813-840f-d6e235a05179')
    })
})
