import { buildMarkSvg, MARK_SIZE } from './mark-art'

export const runtime = 'nodejs'

export async function GET() {
    const { default: sharp } = await import('sharp')
    const png = await sharp(Buffer.from(buildMarkSvg()), { density: 96 })
        .resize(MARK_SIZE, MARK_SIZE)
        .png()
        .toBuffer()

    return new Response(new Uint8Array(png), {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    })
}
