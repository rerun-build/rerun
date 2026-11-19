import { placeOf, rememberPlace } from './reading-place'

describe('where a conversation was left', () => {
    it('remembers how far above its end, and nothing once back at the end', () => {
        rememberPlace('s1', 840)
        expect(placeOf('s1')).toBe(840)
        rememberPlace('s1', null)
        expect(placeOf('s1')).toBeNull()
    })

    it('lets the conversations left longest ago go first', () => {
        for (let index = 0; index < 51; index++) rememberPlace(`old-${index}`, index)
        expect(placeOf('old-0')).toBeNull()
        expect(placeOf('old-50')).toBe(50)
    })
})
