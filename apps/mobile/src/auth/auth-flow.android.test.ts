import { Platform } from 'react-native'

import { installWebCrypto } from '@/auth/auth-flow.android'

type NodeHash = { update(data: string | Uint8Array): NodeHash; digest(): Uint8Array; digest(encoding: 'base64url'): string }
type NodeCrypto = { getRandomValues<T extends ArrayBufferView>(array: T): T; createHash(algorithm: string): NodeHash }
const mockNodeCrypto = () => jest.requireActual<NodeCrypto>('crypto')

const mockGetRandomValues = jest.fn(<T extends ArrayBufferView>(array: T) => mockNodeCrypto().getRandomValues(array))
const mockDigest = jest.fn(async (algorithm: string, data: Uint8Array) => {
    const hash = mockNodeCrypto().createHash(algorithm.replace('-', '').toLowerCase()).update(data).digest()
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength)
})
jest.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomValues: (array: ArrayBufferView) => mockGetRandomValues(array),
    digest: (algorithm: string, data: Uint8Array) => mockDigest(algorithm, data),
}))

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('the PKCE flow on Android', () => {
    const runtimeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const setRuntimeCrypto = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true })

    afterEach(() => {
        if (runtimeCrypto) Object.defineProperty(globalThis, 'crypto', runtimeCrypto)
    })

    it('hashes a random verifier into an S256 challenge where Hermes has no Web Crypto', async () => {
        setRuntimeCrypto(undefined)
        installWebCrypto()
        const { createClient } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js')
        const stored = new Map<string, string>()
        const storage = { getItem: async (key: string) => stored.get(key) ?? null, setItem: async (key: string, value: string) => void stored.set(key, value), removeItem: async (key: string) => void stored.delete(key) }
        const client = createClient('https://project.supabase.co', 'publishable-key', { auth: { flowType: 'pkce', storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false } })

        const { data } = await client.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: 'rerun://auth/callback', skipBrowserRedirect: true } })

        const url = new URL(data.url!)
        const verifier = JSON.parse([...stored.entries()].find(([key]) => key.endsWith('-code-verifier'))![1])
        expect(url.searchParams.get('code_challenge_method')).toBe('s256')
        expect(url.searchParams.get('code_challenge')).toBe(mockNodeCrypto().createHash('sha256').update(verifier).digest('base64url'))
        expect(mockGetRandomValues).toHaveBeenCalled()
        expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array))
    })

    it('keeps a Web Crypto the runtime already has', () => {
        const existing = { getRandomValues: jest.fn(), subtle: { digest: jest.fn() } }
        setRuntimeCrypto(existing)

        installWebCrypto()

        expect(globalThis.crypto).toBe(existing)
    })
})
