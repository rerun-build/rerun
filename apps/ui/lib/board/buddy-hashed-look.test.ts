import { hashedBuddyLook } from '@rerun/ui/iso-grid'
import { describe, expect, it } from 'vitest'

// Worked out with the hash as it stood before a look could be chosen: a coworker nobody dressed must
// keep the face it always had.
describe('hashedBuddyLook', () => {
    it.each([
        ['3a6b9c2d-1e4f-4a5b-8c7d-6e5f4a3b2c12', { eyes: 'dot', mouth: 'none', color: '#00b862' }],
        ['agent-1', { eyes: 'sparkle', mouth: 'none', color: '#4fb800' }],
        ['agent-2', { eyes: 'brows', mouth: 'cat', color: '#00b862' }],
        ['agent-3', { eyes: 'pixel', mouth: 'open', color: '#e935c1' }],
    ])('gives %s the look it had', (id, look) => {
        expect(hashedBuddyLook(id)).toEqual(look)
    })
})
