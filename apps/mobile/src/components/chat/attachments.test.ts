import { MAX_UPLOAD_FILE_BYTES } from '@moldwright/contracts'

import { fitAttachments, imageAttachment, isImage, MAX_ATTACHMENTS, type ComposerAttachment } from './attachments'

jest.mock('@/api/uploads', () => ({ uploadChatFile: jest.fn() }))

const file = (name: string, size?: number): ComposerAttachment => ({ uri: `file:///${name}`, name, mimeType: 'application/pdf', size })

describe('fitAttachments', () => {
    it('keeps no more than the limit and names what did not fit', () => {
        const added = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, index) => file(`f${index}.pdf`))
        const { attachments, noRoom } = fitAttachments([file('kept.pdf')], added)
        expect(attachments).toHaveLength(MAX_ATTACHMENTS)
        expect(noRoom).toEqual(added.slice(MAX_ATTACHMENTS - 1))
    })

    it('sets aside a file over the upload limit', () => {
        const big = file('big.mov', MAX_UPLOAD_FILE_BYTES + 1)
        expect(fitAttachments([], [big, file('ok.pdf', 10)])).toEqual({ attachments: [file('ok.pdf', 10)], tooBig: [big], noRoom: [] })
    })

    it('does not add the same file twice', () => {
        expect(fitAttachments([file('a.pdf')], [file('a.pdf')]).attachments).toHaveLength(1)
    })
})

describe('imageAttachment', () => {
    it('is named after its file, a JPEG', () => {
        const photo = imageAttachment('file:///tmp/IMG_1.jpg', 0)
        expect(photo).toEqual({ uri: 'file:///tmp/IMG_1.jpg', name: 'IMG_1.jpg', mimeType: 'image/jpeg' })
        expect(isImage(photo)).toBe(true)
        expect(isImage(file('a.pdf'))).toBe(false)
    })
})
