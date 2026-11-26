import { BUDDY_EYES, BuddyFace, type BuddyEyes, type BuddyMood, type BuddyMouth } from '@rerun/ui/iso-grid'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

// `EyeDefs` only writes the gradients `eyePaints` says a face uses, and `eyePaints` mirrors the
// branches of `Eyes` by hand. An eye painted with a gradient that was left out gets a
// `fill="url(#…)"` that resolves to nothing and vanishes without a warning: this is the check.
const MOODS: BuddyMood[] = ['idle', 'working', 'error', 'waiting', 'asleep']

function litFace(eyes: BuddyEyes, mood: BuddyMood, { mouth = 'smile', closesEyesAtRest = false }: { mouth?: BuddyMouth; closesEyesAtRest?: boolean } = {}): string {
    const face = createElement(BuddyFace, { uid: 'b', eyes, mouth, mood, depth: 32, light: '#fff', lit: true, tint: '#c084fc', closesEyesAtRest })
    return renderToStaticMarkup(createElement('svg', null, face))
}

function ids(markup: string, pattern: RegExp): Set<string> {
    return new Set([...markup.matchAll(pattern)].map(match => match[1]))
}

function expectEveryGradientDefined(markup: string) {
    const defined = ids(markup, / id="([^"]+)"/g)
    for (const id of ids(markup, /url\(#([^)]+)\)/g)) {
        expect(defined.has(id), `${id} is referenced but never defined`).toBe(true)
    }
}

describe.each(MOODS)('a lit %s face', mood => {
    it.each(BUDDY_EYES)('with %s eyes defines every gradient it paints with', eyes => {
        expectEveryGradientDefined(litFace(eyes, mood))
    })
})

describe('a face that closes its eyes at rest', () => {
    it.each(BUDDY_EYES)('with %s eyes draws them closed while idle', eyes => {
        const markup = litFace(eyes, 'idle', { mouth: 'none', closesEyesAtRest: true })
        expect(markup).toBe(litFace(eyes, 'asleep', { mouth: 'none' }))
        expectEveryGradientDefined(markup)
    })

    it.each(BUDDY_EYES)('with %s eyes opens them while it works', eyes => {
        expect(litFace(eyes, 'working', { closesEyesAtRest: true })).toBe(litFace(eyes, 'working'))
    })

    it('closes the single eye of a cyclops into one arc', () => {
        const arcs = (eyes: BuddyEyes) => ids(litFace(eyes, 'idle', { mouth: 'none', closesEyesAtRest: true }), / d="([^"]+)"/g).size
        expect(arcs('cyclops')).toBe(1)
        expect(arcs('round')).toBe(2)
    })

    // The left eye's closed arc, on a 32-deep wall without a mouth.
    const LEFT_EYE_SHUT = 'd="M13.6 14.4 Q16 '
    it.each<[BuddyEyes, string]>([
        ['glasses', 'r="3.5"'],
        ['shades', 'width="6.8"'],
        ['visor', 'width="24"'],
    ])('with %s keeps the frame and closes the eyes inside it', (eyes, frame) => {
        const markup = litFace(eyes, 'idle', { mouth: 'none', closesEyesAtRest: true })
        expect(markup).toContain(frame)
        expect(markup).toContain(LEFT_EYE_SHUT)
        expect(litFace(eyes, 'idle', { mouth: 'none' })).not.toContain(LEFT_EYE_SHUT)
    })

    it('keeps its mouth at rest', () => {
        const mouthOf = (markup: string) => markup.slice(markup.lastIndexOf('<path'))
        expect(mouthOf(litFace('round', 'idle', { closesEyesAtRest: true }))).toBe(mouthOf(litFace('round', 'idle')))
    })
})
