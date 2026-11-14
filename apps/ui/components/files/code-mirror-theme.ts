import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const CHROME = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--foreground)', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12px', lineHeight: '1.6' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--foreground)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none', paddingRight: '4px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px', minWidth: '2.5rem' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 55%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in oklab, var(--ring) 35%, transparent)',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--ring) 20%, transparent)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'color-mix(in oklab, var(--ring) 25%, transparent)',
        outline: 'none',
    },
    '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderColor: 'var(--border)' },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--ring) 25%, transparent)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--ring) 45%, transparent)' },
})

type Palette = {
    comment: string
    keyword: string
    string: string
    number: string
    name: string
    type: string
    heading: string
    invalid: string
}

const LIGHT: Palette = {
    comment: '#6b7280',
    keyword: '#7c3aed',
    string: '#0f766e',
    number: '#b45309',
    name: '#1d4ed8',
    type: '#0e7490',
    heading: '#111827',
    invalid: '#b91c1c',
}

const DARK: Palette = {
    comment: '#8b949e',
    keyword: '#c4a2ff',
    string: '#7ee0c5',
    number: '#f0b072',
    name: '#88b4ff',
    type: '#6fd3e8',
    heading: '#f5f5f5',
    invalid: '#ff8a8a',
}

function highlightStyle(palette: Palette): HighlightStyle {
    return HighlightStyle.define([
        { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: palette.comment, fontStyle: 'italic' },
        { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier], color: palette.keyword },
        { tag: [tags.string, tags.special(tags.string), tags.regexp], color: palette.string },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], color: palette.number },
        { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: palette.name },
        { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: palette.name },
        { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: palette.type },
        { tag: [tags.heading, tags.strong], color: palette.heading, fontWeight: '600' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.link, color: palette.name, textDecoration: 'underline' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: tags.invalid, color: palette.invalid },
    ])
}

const LIGHT_HIGHLIGHT = syntaxHighlighting(highlightStyle(LIGHT))
const DARK_HIGHLIGHT = syntaxHighlighting(highlightStyle(DARK))

export function codeMirrorTheme(dark: boolean): Extension {
    return [CHROME, dark ? DARK_HIGHLIGHT : LIGHT_HIGHLIGHT]
}
