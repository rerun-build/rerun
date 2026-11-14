import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto'

export const AUTH_FLOW_TYPE = 'pkce' as const

type WebCrypto = {
    getRandomValues: typeof getRandomValues
    subtle: { digest(algorithm: string | { name: string }, data: BufferSource): Promise<ArrayBuffer> }
}

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
