import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const STREAM_WORD = '[data-sd-animate]'

function cssRules(file: string) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map(part => part.trim()), body }))
}

const pageRules = cssRules(path.resolve(import.meta.dirname, '../../../../packages/ui/src/styles.css'))
const streamdownRules = cssRules(path.resolve(import.meta.dirname, '../../node_modules/streamdown/styles.css'))

describe('streamed words while nobody looks at the page', () => {
    it('streamdown still reveals each word through an animation on [data-sd-animate]', () => {
        const wordRule = streamdownRules.find(rule => rule.selectors.includes(STREAM_WORD))
        expect(wordRule?.body).toMatch(/animation:/)
    })

    // Frozen on its first frame, the word animation keeps every new word at opacity 0 (RER-157).
    it('leaves the word animation out of the freeze', () => {
        const freezeRule = pageRules.find(rule => /animation-play-state:\s*paused/.test(rule.body) && rule.selectors.some(selector => selector.startsWith('html[data-unattended] *:')))
        const freezeSelector = freezeRule?.selectors.find(selector => selector.startsWith('html[data-unattended] *:'))
        expect(freezeSelector).toContain(`:not(${STREAM_WORD})`)
    })
})
