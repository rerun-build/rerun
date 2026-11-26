import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'

const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16

// Derived from the service key every hub already has, under a label of its own, so a self-hosted
// install has nothing more to configure. Rotating that key leaves the sealed secrets unreadable: the
// backup codes then stop working until the person asks for new ones, and their own methods still do.
function key(): Buffer {
    const secret = process.env.SUPABASE_SECRET_KEY
    if (!secret) throw new Error('SUPABASE_SECRET_KEY is not configured on this server.')
    return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'rerun two-step recovery', 32))
}

export function sealSecret(secret: string): string {
    const iv = randomBytes(GCM_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key(), iv, { authTagLength: GCM_TAG_BYTES })
    const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.')
}

export function openSecret(sealed: string): string {
    const [iv, tag, body] = sealed.split('.').map(part => Buffer.from(part, 'base64url'))
    if (iv?.length !== GCM_IV_BYTES || tag?.length !== GCM_TAG_BYTES || !body?.length) throw new Error('Invalid sealed secret')
    const decipher = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: GCM_TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
