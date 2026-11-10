import { isAuthCallback } from '@/lib/auth-callbacks'

describe('isAuthCallback', () => {
    it('recognises the OAuth redirects, with their query or fragment', () => {
        expect(isAuthCallback('rerun://auth/callback?code=abc')).toBe(true)
        expect(isAuthCallback('rerun://oauth/callback?status=success&claim=c1')).toBe(true)
        expect(isAuthCallback('/oauth/callback#x')).toBe(true)
    })

    it('leaves every other link to the router', () => {
        expect(isAuthCallback('rerun://chat/42')).toBe(false)
        expect(isAuthCallback('/lab-icons')).toBe(false)
        expect(isAuthCallback('rerun://auth/callback-other')).toBe(false)
        expect(isAuthCallback('exp+rerun://expo-development-client/?url=http%3A%2F%2Flocalhost%3A3102')).toBe(false)
    })
})
