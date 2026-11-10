const ACCENTED: Record<string, string> = {
    a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
    n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
    N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}

// About what German or French add to an English string.
const STRETCH = 0.35

type Output = { parts: string[]; letters: number }

// Text outside any argument, or inside a plural/select branch: every letter is swapped.
function walkText(message: string, start: number, out: Output): number {
    let index = start
    while (index < message.length) {
        const char = message[index]
        if (char === '}') return index
        if (char === '{') {
            index = copyArgument(message, index, out)
            continue
        }
        // A rich text tag (`<link>`, `</b>`) is a name the component maps, never words.
        const tagEnd = char === '<' ? message.indexOf('>', index) : -1
        if (tagEnd > index) {
            out.parts.push(message.slice(index, tagEnd + 1))
            index = tagEnd + 1
            continue
        }
        const swapped = ACCENTED[char]
        if (swapped) out.letters += 1
        out.parts.push(swapped ?? char)
        index += 1
    }
    return index
}

// An argument keeps its name, its type and its branch keywords (`{count, plural, one {...} other {...}}`);
// only the text of its branches goes back through walkText.
function copyArgument(message: string, start: number, out: Output): number {
    out.parts.push('{')
    let index = start + 1
    while (index < message.length && message[index] !== '}') {
        if (message[index] === '{') {
            out.parts.push('{')
            index = walkText(message, index + 1, out)
            out.parts.push('}')
            index += 1
            continue
        }
        out.parts.push(message[index])
        index += 1
    }
    out.parts.push('}')
    return index + 1
}

export function pseudoLocalize(message: string): string {
    const out: Output = { parts: [], letters: 0 }
    walkText(message, 0, out)
    const padding = '~'.repeat(Math.ceil(out.letters * STRETCH))
    return `[${out.parts.join('')}${padding ? ` ${padding}` : ''}]`
}

export function pseudoMessages<T>(messages: T): T {
    if (typeof messages === 'string') return pseudoLocalize(messages) as T
    if (messages && typeof messages === 'object') {
        return Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, pseudoMessages(value)])) as T
    }
    return messages
}
