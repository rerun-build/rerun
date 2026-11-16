import { readHeroAgentApps, readHeroAgentName } from '@/lib/onboarding/hero-handoff'

// A browser drops a cookie past 4 KB without a word: a path longer than this leaves its prompt to
// the store and keeps only the rest.
export const RETURN_PATH_MAX = 3000
const PROMPT_PARAMS = ['prompt', 'name', 'apps']

export type Arrival = {
    returnPath: string
    template: string | null
    share: string | null
    prompt: { text: string; name: string | null; apps: string[] } | null
}

// What a visitor sent to sign in was opening, split between the return cookie and the store.
export function arrivalOf(next: string): Arrival {
    const url = new URL(next, 'http://internal.invalid')
    const query = url.searchParams
    const purchase = query.has('purchase')
    const template = purchase ? null : query.get('template')
    const share = query.get('share')
    const text = query.get('prompt')?.trim() ?? ''
    if (encodeURIComponent(next).length <= RETURN_PATH_MAX || !text) return { returnPath: next, template, share, prompt: null }
    const prompt = { text, name: readHeroAgentName(query), apps: readHeroAgentApps(query) }
    for (const param of PROMPT_PARAMS) query.delete(param)
    const rest = query.toString()
    return { returnPath: `${url.pathname}${rest ? `?${rest}` : ''}`, template, share, prompt }
}
