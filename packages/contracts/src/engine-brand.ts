import { z } from 'zod'
import { isWhiteLabel, type Brand } from './brand.js'

// What a machine is told of the brand it runs under: how its coworkers name the product, and where
// they send someone for help.
export const engineBrandSchema = z.object({
    // Written into every prompt: one line, whatever the hub holds.
    name: z
        .string()
        .transform(name => name.replace(/\s+/g, ' ').trim())
        .pipe(z.string().min(1).max(80)),
    whiteLabel: z.boolean(),
    supportEmail: z.string().nullable().catch(null),
})

export type EngineBrand = z.infer<typeof engineBrandSchema>

export const RERUN_ENGINE_BRAND: EngineBrand = { name: 'Rerun', whiteLabel: false, supportEmail: null }

export function engineBrandOf(brand: Brand): EngineBrand {
    return isWhiteLabel(brand) ? { name: brand.name, whiteLabel: true, supportEmail: brand.supportEmail } : RERUN_ENGINE_BRAND
}

const DOCS_ADDRESS = / \((?:https:\/\/)?docs\.rerun\.build\)/g
// The product as a word of its own. An identifier (`rerun_hub_search_docs`, `RERUN_API_KEY`, `.rerun/`)
// or an address is never one.
const PRODUCT = /(?<![\w./@-])(?:([Aa]) )?Rerun(?!\w|\.\w)/g

// A text Rerun wrote, said under the name of the brand. Never for a text somebody else wrote: the word
// is theirs there.
export function brandedText(text: string, { name, whiteLabel }: Pick<EngineBrand, 'name' | 'whiteLabel'>): string {
    if (!whiteLabel) return text
    return text.replace(DOCS_ADDRESS, '').replace(PRODUCT, (_match, article?: string) => `${article ? `${article}${/^[aeiou]/i.test(name) ? 'n' : ''} ` : ''}${name}`)
}

// What a model is told once, so that the names it reads never reach the person. Empty for Rerun.
export function brandDiscretionNote({ name, whiteLabel, supportEmail }: EngineBrand): string {
    if (!whiteLabel) return ''
    const help = supportEmail ? `For help, a price, a plan or a bill, people write to ${supportEmail}.` : 'For help, a price, a plan or a bill, people write to whoever gave them this workspace.'
    return `The product you are part of is called ${name}, and that is the only name you ever give it. Some technical names you read carry another word, "rerun": tool names (rerun_hub_search_docs), environment variables, file paths, package names, web addresses. They are plumbing: never write that word or a rerun.build address to the user, in any language, and never describe ${name} as built on something else. Say what a tool does instead of its name, and if you are asked what ${name} is built on, say you cannot speak about that. ${help} Never state a price, a plan or an offer of ${name} yourself.`
}
