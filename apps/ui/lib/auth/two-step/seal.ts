import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'

const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16

// The hub raises a session with its recovery factor after a backup code, a passkey or the desktop
// hand-off, so a sealed secret that no longer opens closes all three. Its key is therefore one of its
// own, TWO_STEP_SEAL_KEY, which rotating the service key leaves alone. Several, comma separated: the
// first one seals, every one opens, so it is rotated by putting the new key in front of the old one.
// Without it the service key every hub already has seals, so a self-hosted install has nothing to
// configure; it is still tried last, for an install that names a key of its own later.
function secrets(): string[] {
    const own = (process.env.TWO_STEP_SEAL_KEY ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
    const service = process.env.SUPABASE_SECRET_KEY
    const all = service ? [...own, service] : own
    if (!all.length) throw new Error('Neither TWO_STEP_SEAL_KEY nor SUPABASE_SECRET_KEY is configured on this server.')
    return all
}

function keyOf(secret: string): Buffer {
    return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'rerun two-step recovery', 32))
}

export function sealSecret(secret: string): string {
    const iv = randomBytes(GCM_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', keyOf(secrets()[0]), iv, { authTagLength: GCM_TAG_BYTES })
    const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.')
}

export function openSecret(sealed: string): string {
    const [iv, tag, body] = sealed.split('.').map(part => Buffer.from(part, 'base64url'))
    if (iv?.length !== GCM_IV_BYTES || tag?.length !== GCM_TAG_BYTES || !body?.length) throw new Error('Invalid sealed secret')
    for (const secret of secrets()) {
        try {
            const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), iv, { authTagLength: GCM_TAG_BYTES })
            decipher.setAuthTag(tag)
            return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
        } catch {
            // Sealed under another key: the next one is tried.
        }
    }
    throw new Error('The sealed secret opens with none of the keys of this server.')
}

export function opensSecret(sealed: string): boolean {
    try {
        openSecret(sealed)
        return true
    } catch {
        return false
    }
}
