import { existsSync } from 'node:fs'
import { brainDbPath } from '../config/paths.js'
import { listPageFiles, listPages } from './pages.js'
import { countOpenProposals } from './proposals.js'

const CARD_LINES = 12
const MAX_INDEX_PAGES = 80
const MAX_INDEX_CHARS = 4000
// A shop's product pages share one line, so they never push the identity pages out of the index.
const MAX_PRODUCT_LINE_CHARS = 1500

export const BRAIN_NOTE =
    'The company brain holds what is known about this company: what it sells, to whom, at what price, who works there, how it speaks, the tools it uses, its customers and competitors. What a person wrote or confirmed wins over your memory and over your own assumptions. A section marked unconfirmed was imported from the public web (the website, a LinkedIn page) and nobody at the company confirmed it: take it as a starting point, not a fact. When what you deliver rests on an unconfirmed section saying who the company sells to, how it speaks or what it is aiming for, deliver anyway and open your answer with one line naming that assumption and where it comes from, so the user can correct it (e.g. "I targeted recruiters, as your LinkedIn page says. Tell me if you sell to someone else."); never hold the work back to ask first. Before you answer or produce anything that depends on the company itself, call brain_search, then brain_read the page you need. Before you write anything about one of its products (an ad, a post, a description, an answer to a customer), brain_read that product\'s page; if there is none, or it lacks what you need, read the product\'s page on the company website with your web tools, and look at its picture, before writing. Never describe a product you have not read, and when you are told you got one wrong, go back to the source instead of guessing again. When the user tells you a fact about the company or corrects one, brain_read the page and brain_write the complete new version right away, then say what changed in one line. A fact you found on your own (on the web, in a file, in a tool result) goes to brain_propose with the complete new page, the reason and where it comes from: a person reviews it, and until then the page is unchanged, so never tell the user it is saved. Link other pages with [[slug]]. A link to shared:<path> points to a file of the shared folder: read it with shared_read. A fact about the company never goes into memory_write; your memory is for what concerns your own work.'

// The foreman is the one place the brain is written from a conversation, so its note is the
// opposite of the agents' on that point and the same on everything else.
export const FOREMAN_BRAIN_NOTE =
    'The company brain holds what is known about this company: what it sells, to whom, at what price, who works there, how it speaks, the tools it uses, its customers and competitors. Every coworker of the workspace reads it, and you keep it with the person you are talking to. A section marked unconfirmed was imported from the public web (the website, a LinkedIn page) and nobody at the company confirmed it: a starting point, not a fact. The rest was written or approved by a person. Before you answer or produce anything that depends on the company itself, call brain_search, then brain_read the page you need. Before you write anything about one of its products (an ad, a post, a description, an answer to a customer), brain_read that product\'s page; if there is none, or it lacks what you need, read the product\'s page on the company website with your web tools, and look at its picture, before writing. Never describe a product you have not read, and when you are told you got one wrong, go back to the source instead of guessing again. When the user tells you a fact about the company, asks you to change a page or confirms a change you suggested, brain_read the page and brain_write the complete new version right away: it is saved, so say what changed in one line. A fact you found on your own (on the web, in a file, from a coworker) is a change you suggest with ask_user first, never one you write unasked. Deleting a page goes through request_approval first, then brain_delete with confirm: true. The coworkers propose changes instead of writing them: brain_proposals lists the ones waiting, and brain_decide accepts or dismisses one once the user decided it. Mention the waiting ones when they bear on what the user is doing. Link other pages with [[slug]]. A link to shared:<path> points to a file of the shared folder: read it with shared_read. Call open_brain_page to show a page or the waiting changes to the user.'

const EMPTY = 'The company brain is still empty.'
export const EMPTY_FOR_AGENTS = `${EMPTY} Before you ask the user what the company does or sells, ask the coworkers of the workspace who may already know (call_agent): one that worked on its website or its marketing has usually read it.`
// A coworker asked by another one passing the question on is how an empty brain turned into a loop
// of coworkers asking each other (649 sessions in 7 minutes on one trial).
export const EMPTY_WHEN_CALLED = `${EMPTY} Another coworker is asking you: answer it from what you already hold, even if that is nothing, and never pass its question on to another coworker.`

function cardExcerpt(content: string): string {
    return content
        .split('\n')
        .map(l => l.trimEnd())
        .filter(l => l.trim().length > 0)
        .slice(0, CARD_LINES)
        .join('\n')
}

// Lives in the system prompt rather than in the per-turn recall: it changes when a person accepts
// something, not on every message, so the prompt stays cacheable.
export async function buildBrainSection(calledByCoworker = false): Promise<string> {
    return [BRAIN_NOTE, ...(await brainIndex(calledByCoworker ? EMPTY_WHEN_CALLED : EMPTY_FOR_AGENTS))].join('\n\n')
}

export async function buildForemanBrainSection(): Promise<string> {
    const parts = [FOREMAN_BRAIN_NOTE, ...(await brainIndex(EMPTY))]
    const waiting = existsSync(brainDbPath()) ? await countOpenProposals() : 0
    if (waiting > 0) parts.push(`Changes proposed by the coworkers, waiting for review: ${waiting} (brain_proposals).`)
    return parts.join('\n\n')
}

async function brainIndex(empty: string): Promise<string[]> {
    if (!existsSync(brainDbPath())) return [empty]
    const [pages, files] = await Promise.all([listPages(), listPageFiles()])
    if (pages.length === 0) return [empty]
    const unconfirmed = new Map(files.map(file => [file.slug, file.unconfirmed]))
    const company = files.find(file => file.slug === 'company')

    const parts: string[] = []
    if (company?.content) {
        const unconfirmedLine = company.unconfirmed.length ? `\nUnconfirmed: ${company.unconfirmed.join(', ')}` : ''
        parts.push(`Company card (brain_read "company" for the rest):\n${cardExcerpt(company.content)}${unconfirmedLine}`)
    }

    const products = pages.filter(page => page.type === 'product')
    const others = pages.filter(page => page.type !== 'product')

    const lines: string[] = []
    let chars = 0
    for (const page of others.slice(0, MAX_INDEX_PAGES)) {
        const headings = unconfirmed.get(page.slug) ?? []
        const line = `- [[${page.slug}]] ${page.title} (${page.type}${headings.length ? `, unconfirmed: ${headings.join(', ')}` : ''})`
        if (chars + line.length > MAX_INDEX_CHARS) break
        lines.push(line)
        chars += line.length + 1
    }
    const more = others.length - lines.length
    if (products.length) lines.push(productLine(products))
    parts.push(`Pages:\n${lines.join('\n')}${more > 0 ? `\n... and ${more} more, find them with brain_search.` : ''}`)
    return parts
}

function productLine(products: { slug: string; title: string }[]): string {
    const links: string[] = []
    let chars = 0
    for (const product of products) {
        const link = `[[${product.slug}]] ${product.title}`
        if (chars + link.length > MAX_PRODUCT_LINE_CHARS) break
        links.push(link)
        chars += link.length + 2
    }
    const more = products.length - links.length
    return `- Products (${products.length}): ${links.join(', ')}${more > 0 ? `, and ${more} more, find them with brain_search` : ''}`
}
