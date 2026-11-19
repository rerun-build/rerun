import { appendAttachmentsRef, appendVoiceMarker, buildAttachmentsRef, buildVoiceMarker, encodePeaks } from '@moldwright/contracts'

import { userTextOf, voiceOf } from '@/components/chat/message-text'

describe('message view', () => {
    it('shows what the person wrote, without the markers the hub reads', () => {
        const withFiles = appendAttachmentsRef('Here is the deck', buildAttachmentsRef(['chat-uploads/deck.pdf']))
        expect(userTextOf({ id: 'u', role: 'user', parts: [{ type: 'text', text: withFiles }] })).toBe('Here is the deck')
        const spoken = appendVoiceMarker('Call them back', buildVoiceMarker({ src: 'chat-uploads/v.m4a', durationMs: 1200, levels: [0.2, 0.4] }))
        expect(userTextOf({ id: 'u', role: 'user', parts: [{ type: 'text', text: spoken }] })).toBe('Call them back')
    })

    it('reads a voice message from the marker of the message just sent, attachments after it', () => {
        const spoken = appendVoiceMarker('Call them back', buildVoiceMarker({ src: 'chat-uploads/v.m4a', durationMs: 4200, levels: [0.2, 0.8] }))
        const withPhoto = appendAttachmentsRef(spoken, buildAttachmentsRef(['chat-uploads/photo.jpg']))
        const voice = voiceOf({ id: 'u', role: 'user', parts: [{ type: 'text', text: withPhoto }] })
        expect(voice).toMatchObject({ transcript: 'Call them back', src: 'chat-uploads/v.m4a', durationMs: 4200 })
        expect(voice?.peaks).toHaveLength(48)
    })

    it('reads a voice message from the metadata of the transcript read back', () => {
        const metadata = { voice: { transcript: 'Call them back', src: 'chat-uploads/v.m4a', durationMs: 4200, peaks: encodePeaks([0.5]) } }
        const voice = voiceOf({ id: 'u', role: 'user', parts: [{ type: 'text', text: '' }], metadata })
        expect(voice).toMatchObject({ src: 'chat-uploads/v.m4a', durationMs: 4200 })
        expect(voice?.peaks[0]).toBeCloseTo(0.51, 1)
    })

    it('finds no voice in a typed message', () => {
        expect(voiceOf({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] })).toBeNull()
    })
})
