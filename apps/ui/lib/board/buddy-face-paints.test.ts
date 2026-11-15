import { BUDDY_EYES, BuddyFace, type BuddyEyes, type BuddyMood } from '@rerun/ui/iso-grid'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const MOODS: BuddyMood[] = ['idle', 'working', 'error', 'waiting', 'asleep']

function litFace(eyes: BuddyEyes, mood: BuddyMood): string {
    const face = createElement(BuddyFace, { uid: 'b', eyes, mouth: 'smile', mood, depth: 32, light: '#fff', lit: true, tint: '#c084fc' })
    return renderToStaticMarkup(createElement('svg', null, face))
}

function ids(markup: string, pattern: RegExp): Set<string> {
    return new Set([...markup.matchAll(pattern)].map(match => match[1]))
}

describe.each(MOODS)('a lit %s face', mood => {
    it.each(BUDDY_EYES)('with %s eyes defines every gradient it paints with', eyes => {
        const markup = litFace(eyes, mood)
        const defined = ids(markup, / id="([^"]+)"/g)
        for (const id of ids(markup, /url\(#([^)]+)\)/g)) {
            expect(defined.has(id), `${id} is referenced but never defined`).toBe(true)
        }
    })
})
