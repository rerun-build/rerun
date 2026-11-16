// A sentence is said as soon as it is whole: a terminator followed by a space, or a line break. A
// terminator at the very end of the text waits, since "3." may still become "3.5".
const SENTENCE_END = /[.!?…]+["')\]»]*(?=\s)|\n+/g
// The first words of an answer are said at its first clause, so the caller hears a voice sooner.
const CLAUSE_END = /[.!?…]+["')\]»]*(?=\s)|[,;:](?=\s)|\n+/g
const MIN_CLAUSE_WORDS = 3

const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)])(?:\s+|$)/

// What a synthesizer should read of a piece of markdown: the words, without the marks around them.
export function spokenText(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/^\s*[-=_]{3,}\s*$/, '')
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(LIST_MARKER, '')
        .replace(/[*`~]|__/g, '')
        .replace(/\s*\|\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,]+|[\s,]+$/g, '')
}

// The sentences completed in `text` past `from`, and where the next read starts. With `early`, the
// first one handed over may stop at a clause, as long as it is more than a word or two.
export function takeSentences(text: string, from: number, early = false): { sentences: string[]; next: number } {
    const sentences: string[] = []
    let next = from
    let scan = from
    for (;;) {
        const pattern = early && sentences.length === 0 ? CLAUSE_END : SENTENCE_END
        pattern.lastIndex = scan
        const match = pattern.exec(text)
        if (!match) break
        const end = match.index + match[0].length
        scan = end
        const sentence = spokenText(text.slice(next, end))
        if (/^[,;:]$/.test(match[0]) && sentence.split(' ').length < MIN_CLAUSE_WORDS) continue
        if (sentence) sentences.push(sentence)
        next = end
    }
    return { sentences, next }
}
