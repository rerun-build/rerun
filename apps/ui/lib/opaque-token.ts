const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function opaqueToken(length: number): string {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let token = ''
    for (const byte of bytes) token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]
    return token
}

export function isOpaqueToken(value: string, length: number): boolean {
    return value.length === length && [...value].every(char => TOKEN_ALPHABET.includes(char))
}
