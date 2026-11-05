import { describe, expect, it } from 'vitest'
import { appendVoiceMarker, buildVoiceMarker, parseVoiceMessage, stripVoiceMarker, transcriptWords } from './marker'

const marker = buildVoiceMarker({ src: 'chat-uploads/abc-voice.webm', durationMs: 12480, levels: [0, 1, 0.5] })

describe('buildVoiceMarker', () => {
    it('rounds the duration and escapes quotes', () => {
        expect(buildVoiceMarker({ src: 'a"b.webm', durationMs: 12.7, levels: [] })).toBe('<voice src="a&quot;b.webm" ms="13" peaks="">')
    })

    it('never emits a negative duration', () => {
        expect(buildVoiceMarker({ src: 'a.webm', durationMs: -5, levels: [] })).toContain('ms="0"')
    })
})

describe('parseVoiceMessage', () => {
    it('round-trips a transcript plus its marker', () => {
        const parsed = parseVoiceMessage(appendVoiceMarker('  Hello there  ', marker))
        expect(parsed?.transcript).toBe('Hello there')
        expect(parsed?.src).toBe('chat-uploads/abc-voice.webm')
        expect(parsed?.durationMs).toBe(12480)
        expect(parsed?.peaks).toHaveLength(48)
    })

    it('reads a marker with no transcript', () => {
        expect(parseVoiceMessage(appendVoiceMarker('', marker))?.transcript).toBe('')
    })

    it('unescapes quotes in the path', () => {
        expect(parseVoiceMessage('<voice src="a&quot;b.webm" ms="1" peaks="">')?.src).toBe('a"b.webm')
    })

    it('ignores a marker that is not at the end', () => {
        expect(parseVoiceMessage(`${marker}\n\ntrailing text`)).toBeNull()
    })

    it('returns null on a plain message', () => {
        expect(parseVoiceMessage('Just a normal message')).toBeNull()
    })

    it('returns null when src is missing', () => {
        expect(parseVoiceMessage('<voice ms="12" peaks="">')).toBeNull()
    })

    it('does not let a > inside an attribute close the tag early', () => {
        expect(parseVoiceMessage('<voice src="a>b.webm" ms="1" peaks="">')?.src).toBe('a>b.webm')
    })
})

describe('stripVoiceMarker', () => {
    it('leaves the transcript alone', () => {
        expect(stripVoiceMarker(appendVoiceMarker('Ship it tomorrow', marker))).toBe('Ship it tomorrow')
    })

    it('leaves a plain message untouched', () => {
        expect(stripVoiceMarker('Ship it tomorrow')).toBe('Ship it tomorrow')
    })
})

describe('transcriptWords', () => {
    it('keeps every character, words and gaps alike', () => {
        const text = 'Okay  so\nsend them.'
        expect(
            transcriptWords(text)
                .map(word => word.text)
                .join('')
        ).toBe(text)
    })

    it('places each word by the characters before it', () => {
        expect(transcriptWords('ab cd')).toEqual([
            { text: 'ab', start: 0 },
            { text: ' ', start: 0.4 },
            { text: 'cd', start: 0.6 },
        ])
    })

    it('reads an empty transcript as no words', () => {
        expect(transcriptWords('')).toEqual([])
    })
})
