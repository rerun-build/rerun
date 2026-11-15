import { warmImage } from '@/lib/og/warm'

const WARM_CONCURRENCY = 2

const WARM_TIMEOUT_MS = 25_000

export function templateCardStamp(row: { updated_at: string | null; card_image_dark_url: string | null }): string {
    const file = row.card_image_dark_url?.split('/').pop()?.split('?')[0]
    return file || row.updated_at || 'none'
}

const EMAIL_CARD_LAYOUT = '2'

export function templateEmailCardUrl(appUrl: string, slug: string, stamp: string): string {
    return `${appUrl}/og/templates/${encodeURIComponent(slug)}/email-card?v=${encodeURIComponent(`${EMAIL_CARD_LAYOUT}.${stamp}`)}`
}

export async function warmTemplateEmailCards(urls: string[]): Promise<Set<string>> {
    const ready = new Set<string>()

    for (let index = 0; index < urls.length; index += WARM_CONCURRENCY) {
        const batch = urls.slice(index, index + WARM_CONCURRENCY)
        const results = await Promise.all(batch.map(url => warmImage(url, WARM_TIMEOUT_MS)))
        batch.forEach((url, at) => {
            if (results[at]) ready.add(url)
        })
    }

    return ready
}
