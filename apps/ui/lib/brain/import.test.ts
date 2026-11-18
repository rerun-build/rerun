import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { importedPaths, importPathOf, MAX_IMPORT_FILES, MAX_IMPORT_UNPACKED_BYTES, prepareImport } from './import'

const text = (value: string) => new TextEncoder().encode(value)
const zipFile = (name: string, entries: Record<string, Uint8Array>) => new File([zipSync(entries) as Uint8Array<ArrayBuffer>], name)

describe('preparing an import', () => {
    it('unpacks a .zip into a folder named after it, keeping its tree and leaving out what a Mac adds', async () => {
        const archive = zipFile('acme-onboarding.zip', {
            'contract.pdf': text('pdf'),
            'notes/kickoff.md': text('# Kickoff'),
            '__MACOSX/._contract.pdf': text('x'),
            '.DS_Store': text('x'),
        })
        const prepared = await prepareImport([{ file: archive, subDir: '' }, { file: new File(['hi'], 'call-recap.docx'), subDir: '' }])
        expect(prepared.files.map(item => [importPathOf(item.entry), item.archive, item.label])).toEqual([
            ['acme-onboarding/contract.pdf', 'acme-onboarding.zip', 'contract.pdf'],
            ['acme-onboarding/notes/kickoff.md', 'acme-onboarding.zip', 'notes/kickoff.md'],
            ['call-recap.docx', null, 'call-recap.docx'],
        ])
        expect(await prepared.files[1].entry.file.text()).toBe('# Kickoff')
        expect(prepared).toMatchObject({ failed: [], tooLarge: [], truncated: false })
    })

    it('keeps a dropped folder as it is and files the folder with its files', async () => {
        const prepared = await prepareImport([
            { file: new File(['svg'], 'logo.svg'), subDir: 'brand-kit' },
            { file: new File(['ttf'], 'Inter.ttf'), subDir: 'brand-kit/fonts' },
            { file: new File(['x'], '.DS_Store'), subDir: 'brand-kit' },
        ])
        expect(importedPaths(prepared.files).sort()).toEqual(['brand-kit', 'brand-kit/fonts/Inter.ttf', 'brand-kit/logo.svg'])
    })

    it('says which archive could not be opened, and stops at the number of files one import takes', async () => {
        const broken = await prepareImport([{ file: new File(['not a zip'], 'broken.zip'), subDir: '' }])
        expect(broken).toMatchObject({ files: [], failed: ['broken.zip'] })

        const unreadable = new File(['x'], 'moved.zip')
        unreadable.arrayBuffer = () => Promise.reject(new Error('NotReadableError'))
        expect(await prepareImport([{ file: unreadable, subDir: '' }])).toMatchObject({ files: [], failed: ['moved.zip'] })

        const many = Array.from({ length: MAX_IMPORT_FILES + 3 }, (_, index) => ({ file: new File(['x'], `f${index}.txt`), subDir: '' }))
        const prepared = await prepareImport(many)
        expect(prepared.files).toHaveLength(MAX_IMPORT_FILES)
        expect(prepared.truncated).toBe(true)
    })

    it('leaves out an archive heavier than one import takes without reading it', async () => {
        const huge = new File(['x'], 'archive.zip')
        Object.defineProperty(huge, 'size', { value: MAX_IMPORT_UNPACKED_BYTES + 1 })
        let read = false
        huge.arrayBuffer = () => {
            read = true
            return Promise.resolve(new ArrayBuffer(0))
        }
        expect(await prepareImport([{ file: huge, subDir: '' }])).toMatchObject({ files: [], tooLarge: ['archive.zip'] })
        expect(read).toBe(false)
    })
})
