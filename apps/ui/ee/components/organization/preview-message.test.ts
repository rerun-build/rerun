import { describe, expect, it } from 'vitest'

import { draftMessage, isPreviewReady, PREVIEW_READY, readDraftMessage } from './preview-message'

const DRAFT = { name: 'Nordlys', iconUrl: null, color: '#1668e3', supportEmail: null }

describe('what a preview is told', () => {
    it('reads the draft it was sent', () => {
        expect(readDraftMessage(draftMessage(DRAFT))).toEqual(DRAFT)
    })

    it.each([null, 'draft', {}, { type: 'organization-brand-draft' }, { type: 'other', draft: DRAFT }, { type: 'organization-brand-draft', draft: { ...DRAFT, name: 3 } }])('takes %j for nothing', data => {
        expect(readDraftMessage(data)).toBeNull()
    })

    it('tells when it is ready', () => {
        expect(isPreviewReady(PREVIEW_READY)).toBe(true)
        for (const data of [null, undefined, 'ready', { type: 'x' }]) expect(isPreviewReady(data)).toBe(false)
    })
})
