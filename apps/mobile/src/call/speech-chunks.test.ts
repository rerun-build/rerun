import { spokenText, takeSentences } from './speech-chunks'

describe('takeSentences', () => {
    it('hands over a sentence once a space follows its terminator', () => {
        expect(takeSentences('Hello there. How are', 0)).toEqual({ sentences: ['Hello there.'], next: 12 })
    })

    it('keeps a terminator at the end of the text for the next read', () => {
        expect(takeSentences('It costs 3.', 0)).toEqual({ sentences: [], next: 0 })
        expect(takeSentences('It costs 3.5 euros. ', 0).sentences).toEqual(['It costs 3.5 euros.'])
    })

    it('goes on from where the last read stopped', () => {
        const text = 'One. Two! Three? Four'
        const first = takeSentences(text.slice(0, 8), 0)
        expect(first.sentences).toEqual(['One.'])
        expect(takeSentences(text, first.next).sentences).toEqual(['Two!', 'Three?'])
    })

    it('ends a sentence on a line break', () => {
        expect(takeSentences('Let me check\nDone', 0).sentences).toEqual(['Let me check'])
    })

    it('stops the first sentence at a clause when asked to speak early', () => {
        expect(takeSentences('Oui bien sûr, je regarde ça, puis je te dis. Et', 0, true).sentences).toEqual(['Oui bien sûr', 'je regarde ça, puis je te dis.'])
    })

    it('does not speak early on a word or two', () => {
        expect(takeSentences('Salut, ça va très bien. Et', 0, true).sentences).toEqual(['Salut, ça va très bien.'])
    })

    it('says the items of a list without their markers', () => {
        expect(takeSentences('1. First item\n- **Second** item\n', 0).sentences).toEqual(['First item', 'Second item'])
    })
})

describe('spokenText', () => {
    it('keeps the words of a link and drops a bare address', () => {
        expect(spokenText('See [the report](https://example.com/r) or https://example.com now')).toBe('See the report or now')
    })

    it('drops the marks of a heading, of emphasis and of code', () => {
        expect(spokenText('## A `quick` **answer**')).toBe('A quick answer')
    })

    it('is empty for a line that only draws something', () => {
        expect(spokenText('***')).toBe('')
        expect(spokenText('---')).toBe('')
        expect(spokenText('2.')).toBe('')
    })
})
