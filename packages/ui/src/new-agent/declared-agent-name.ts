import { AGENT_NAME_MAX } from './reading'

const PREAMBLE = /^(?:you are|you're|you’re|your name is|tu es|tu t'appelles|tu t’appelles|vous êtes|vous vous appelez)\s+((?:an?|the|une?|le|la)\s+|l['’])?/i
const HEADING = /^#{1,3}\s+/
const CLAUSE_END = /\s[-–—]\s|[,.;:!?()[\]—–\n]/
const NAME_WORD = /^[\p{Lu}\p{N}][\p{L}\p{N}&+.'’-]*$/u
const POSSESSIVE = /['’]s$/i
const MAX_NAME_WORDS = 4
const LINES_LOOKED_AT = 3

const SECTION_HEADINGS = new Set(['soul', 'soul.md', 'identity', 'role', 'mission', 'instructions', 'system prompt', 'prompt', 'overview', 'context', 'brief', 'persona', 'purpose', 'goal', 'goals', 'about', 'rules', 'agent', 'coworker', 'who you are', 'identité', 'rôle', 'contexte', 'objectif', 'objectifs', 'consignes'])

function clause(text: string): string {
    return text.split(CLAUSE_END)[0].trim()
}

function bounded(words: string[]): string | null {
    const name = words.join(' ').slice(0, AGENT_NAME_MAX).trimEnd()
    return name || null
}

function nameFromHeading(heading: string): string | null {
    const words = clause(heading).split(/\s+/).filter(Boolean)
    if (words.length === 0 || words.length > MAX_NAME_WORDS || !words.every(word => NAME_WORD.test(word))) return null
    if (SECTION_HEADINGS.has(words.join(' ').toLowerCase())) return null
    return bounded(words)
}

function nameFromPreamble(line: string): string | null {
    const preamble = line.match(PREAMBLE)
    if (!preamble) return null
    const clauseWords = clause(line.slice(preamble[0].length)).split(/\s+/).filter(Boolean)
    const words: string[] = []
    for (const word of clauseWords) {
        if (!NAME_WORD.test(word) || POSSESSIVE.test(word)) break
        words.push(word)
    }
    if (words.length === 0 || words.length > MAX_NAME_WORDS) return null
    const articled = preamble[1] !== undefined
    if (articled && words.length === 1 && clauseWords.length > 1) return null
    return bounded(words)
}

export function declaredAgentName(text: string): string | null {
    const lines = text
        .split('\n')
        .map(line => line.replace(/[*_`>]/g, '').trim())
        .filter(Boolean)
        .slice(0, LINES_LOOKED_AT)

    for (const line of lines) {
        if (!HEADING.test(line)) return nameFromPreamble(line)
        const name = nameFromHeading(line.replace(HEADING, ''))
        if (name) return name
    }
    return null
}
