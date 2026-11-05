import { describe, expect, it } from 'vitest'
import { htmlTitle } from './title'

describe('htmlTitle', () => {
    it('reads the title, decoded and squashed', () => {
        expect(htmlTitle('<head><title>\n  Q3 &amp; Q4 &#8211; Acme </title></head>')).toBe('Q3 & Q4 – Acme')
    })

    it('answers null for a page with no title or an empty one', () => {
        expect(htmlTitle('<h1>Hi</h1>')).toBeNull()
        expect(htmlTitle('<title>  </title>')).toBeNull()
    })
})
