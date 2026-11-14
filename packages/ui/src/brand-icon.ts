export type BrandIconTone = 'color' | 'dark' | 'light'

const TONE_PARAM = 'tone'

export function brandIconToneFromUrl(src: string): BrandIconTone {
    try {
        const tone = new URL(src, 'https://rerun.build').searchParams.get(TONE_PARAM)
        return tone === 'dark' || tone === 'light' ? tone : 'color'
    } catch {
        return 'color'
    }
}

export function withBrandIconTone(src: string, tone: BrandIconTone): string {
    try {
        const url = new URL(src)
        if (tone === 'color') url.searchParams.delete(TONE_PARAM)
        else url.searchParams.set(TONE_PARAM, tone)
        return url.toString()
    } catch {
        return src
    }
}

export function brandIconFilter(src: string): string | undefined {
    const tone = brandIconToneFromUrl(src)
    if (tone === 'dark') return 'var(--dark-brand-icon-filter)'
    if (tone === 'light') return 'var(--light-brand-icon-filter)'
    return undefined
}
