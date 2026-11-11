import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto'

// Android signs in with Apple through the browser: PKCE keeps the code useless to any other app that
// would catch the rerun:// redirect.
export const AUTH_FLOW_TYPE = 'pkce' as const

type WebCrypto = {
    getRandomValues: typeof getRandomValues
    subtle: { digest(algorithm: string | { name: string }, data: BufferSource): Promise<ArrayBuffer> }
}

// Supabase draws the PKCE verifier and hashes it with Web Crypto, which Hermes does not have: without
// it the verifier comes from Math.random and goes out in clear as a "plain" challenge.
export function installWebCrypto() {
    const scope = globalThis as { crypto?: Partial<WebCrypto> }
    if (typeof scope.crypto?.getRandomValues === 'function' && typeof scope.crypto.subtle?.digest === 'function') return
    scope.crypto = {
        ...scope.crypto,
        getRandomValues,
        subtle: { digest: (algorithm, data) => digest((typeof algorithm === 'string' ? algorithm : algorithm.name) as CryptoDigestAlgorithm, data) },
    }
}

installWebCrypto()
