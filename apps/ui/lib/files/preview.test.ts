import { describe, expect, it } from 'vitest'
import { ArchiveIcon, BinaryIcon, Code2 } from '@/lib/icons'
import { fileExtension, filePreviewKind, fileTypeIcon, framedHtmlDocument, isArchive, isCode, textPreviewFormat } from './preview'

describe('fileExtension', () => {
    it('lowercases the last extension and has none without a dot', () => {
        expect(fileExtension('Archive.TAR.GZ')).toBe('gz')
        expect(fileExtension('Makefile')).toBe('')
        expect(fileExtension('.env')).toBe('env')
    })
})

describe('filePreviewKind', () => {
    it('recognises each renderable kind whatever the case', () => {
        expect(filePreviewKind('photo.JPG')).toBe('image')
        expect(filePreviewKind('doc.pdf')).toBe('pdf')
        expect(filePreviewKind('voice.m4a')).toBe('audio')
        expect(filePreviewKind('clip.MOV')).toBe('video')
        expect(filePreviewKind('font.woff2')).toBe('binary')
    })

    it('reads anything unknown or without extension as text', () => {
        expect(filePreviewKind('notes.md')).toBe('text')
        expect(filePreviewKind('Dockerfile')).toBe('text')
        expect(filePreviewKind('data.xyz')).toBe('text')
    })
})

describe('textPreviewFormat', () => {
    it('draws HTML and Markdown as pages, whatever the case', () => {
        expect(textPreviewFormat('report.HTML')).toBe('html')
        expect(textPreviewFormat('old.htm')).toBe('html')
        expect(textPreviewFormat('notes.md')).toBe('markdown')
        expect(textPreviewFormat('README.markdown')).toBe('markdown')
    })

    it('keeps any other text as its source', () => {
        expect(textPreviewFormat('notes.txt')).toBe('plain')
        expect(textPreviewFormat('Dockerfile')).toBe('plain')
        expect(textPreviewFormat('index.ts')).toBe('plain')
    })
})

describe('framedHtmlDocument', () => {
    it('opens links in a new tab and sends no referrer, ahead of the page itself', () => {
        const framed = framedHtmlDocument('<!doctype html><p>Hi</p>')
        expect(framed).toBe('<meta name="referrer" content="no-referrer"><base href="about:srcdoc" target="_blank"><!doctype html><p>Hi</p>')
    })

    it('keeps a table of contents inside the page and leaves other links alone', () => {
        const framed = framedHtmlDocument('<a href="#summary">Summary</a> <A class="toc" href=\'#data\'>Data</A> <a href="https://example.com/#top">Source</a> <abbr title="#x">x</abbr>')
        expect(framed).toContain('<a target="_self" href="#summary">')
        expect(framed).toContain('<a target="_self" class="toc" href=\'#data\'>')
        expect(framed).toContain('<a href="https://example.com/#top">')
        expect(framed).toContain('<abbr title="#x">')
    })
})

describe('fileTypeIcon', () => {
    it('tells an archive from another binary', () => {
        expect(fileTypeIcon('bundle.zip')).toBe(ArchiveIcon)
        expect(isArchive('bundle.zip')).toBe(true)
        expect(fileTypeIcon('lib.wasm')).toBe(BinaryIcon)
    })

    it('gives code a glyph and leaves plain text, images and pdfs without one', () => {
        expect(isCode('index.ts')).toBe(true)
        expect(fileTypeIcon('index.ts')).toBe(Code2)
        expect(fileTypeIcon('notes.txt')).toBeNull()
        expect(fileTypeIcon('photo.png')).toBeNull()
        expect(fileTypeIcon('doc.pdf')).toBeNull()
    })
})
