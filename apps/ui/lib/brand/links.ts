import { docsUrl, landingUrl } from '@/lib/site'
import { isWhiteLabel, type Brand } from '@rerun/contracts'

export function brandDocsUrl(brand: Brand): string | null {
    return isWhiteLabel(brand) ? brand.links.docs : docsUrl()
}

// Both or neither: the sentence that links them names the two.
export function brandTerms(brand: Brand): { terms: string; privacy: string } | null {
    if (!isWhiteLabel(brand)) return { terms: landingUrl('/terms'), privacy: landingUrl('/privacy') }
    const { terms, privacy } = brand.links
    return terms && privacy ? { terms, privacy } : null
}
