import { readFile } from 'node:fs/promises'
import { ImageResponse } from 'next/og'

import { getBrand } from '@/lib/brand/server'
import { brandPalette, isWhiteLabel } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

const SIZE = 512

let font: Promise<Buffer> | null = null
const semibold = () => (font ??= readFile(new URL('../../_fonts/Inter-SemiBold.ttf', import.meta.url)))

// The icon of a brand whose team uploaded none yet: its initial on the dark tile its logo is drawn on
// in the app. A tab, a home screen and an installed app show this, never Rerun's.
export async function GET() {
    const brand = await getBrand()
    if (!isWhiteLabel(brand)) return new Response(null, { status: 404 })
    const { brand: fill, brandInk: ink } = brandPalette(null).light
    return new ImageResponse(
        <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: fill, color: ink, fontFamily: 'Inter', fontSize: 300, fontWeight: 600 }}>{brand.name.trim().charAt(0).toUpperCase()}</div>,
        { width: SIZE, height: SIZE, fonts: [{ name: 'Inter', data: await semibold(), weight: 600, style: 'normal' }], headers: { 'Cache-Control': 'public, max-age=3600' } },
    )
}
