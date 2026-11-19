import type { BrandIconTone } from '@moldwright/ui/brand-icon'

import { classifyRgbaPixels } from './icon-tone'

const SAMPLE_SIZE = 64

export async function analyzeBrandIconTone(bytes: Uint8Array): Promise<BrandIconTone> {
    const { default: sharp } = await import('sharp')
    const { data } = await sharp(bytes, { failOn: 'none' })
        .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    return classifyRgbaPixels(data)
}
