import { describe, expect, it, vi } from 'vitest'

vi.mock('@/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))

const { BLOB_ILLUSTRATIONS, getBlobByFile, randomBlob } = await import('./catalog')

describe('the catalogue of an install without the illustration library', () => {
    it('offers no illustration and draws none', () => {
        expect(BLOB_ILLUSTRATIONS).toEqual([])
        expect(randomBlob()).toBeUndefined()
        expect(getBlobByFile('green-energy-blob.webp')).toBeUndefined()
    })
})
