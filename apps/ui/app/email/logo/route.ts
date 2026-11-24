import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

// Mail already in inboxes asks for /email/logo?v=<n>: whatever version it names gets today's mark.
const LOGO_PATH = path.join(process.cwd(), 'public', 'email', 'logo.png')

export async function GET() {
    const png = await readFile(LOGO_PATH)
    return new Response(new Uint8Array(png), {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    })
}
