'use client'

import { type ClipboardEvent, type KeyboardEvent, type SyntheticEvent, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { collapseLinks, type ComposerLinks, type ComposerMention, type ComposerSegment, expandLinks, type TextRange, tokenizeComposer, tokenRanges, urlBeforeCaret } from '@/lib/chat/composer-links'

function replaceRange(el: HTMLTextAreaElement, { start, end }: TextRange, text: string) {
    el.focus()
    el.setSelectionRange(start, end)
    const done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete')
    if (!done) {
        el.setRangeText(text, start, end, 'end')
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }
}

function selection(el: HTMLTextAreaElement): TextRange {
    return { start: el.selectionStart, end: el.selectionEnd }
}

function widen({ start, end }: TextRange, ranges: TextRange[]): TextRange {
    for (const range of ranges) {
        if (range.start < start && start < range.end) start = range.start
        if (range.start < end && end < range.end) end = range.end
    }
    return { start, end }
}

const NO_MENTIONS: ComposerMention[] = []
const NO_LINKS: ComposerLinks = new Map()

export function useComposerLinks(mentions: ComposerMention[] = NO_MENTIONS) {
    const linksRef = useRef<ComposerLinks>(new Map())
    const mentionsRef = useRef(mentions)
    const mirrorElRef = useRef<HTMLDivElement | null>(null)
    const lastCaretRef = useRef(0)
    const [linkSegments, setLinkSegments] = useState<ComposerSegment[]>([])

    useEffect(() => {
        mentionsRef.current = mentions
    })

    const segments = useMemo(() => linkSegments.flatMap(segment => (segment.kind === 'text' ? tokenizeComposer(segment.text, NO_LINKS, mentions) : [segment])), [linkSegments, mentions])

    const refresh = useCallback((text: string) => setLinkSegments(tokenizeComposer(text, linksRef.current)), [])
    const ranges = useCallback((text: string) => tokenRanges(text, linksRef.current, mentionsRef.current), [])

    const expand = useCallback((text: string) => expandLinks(text, linksRef.current), [])
    const collapse = useCallback((text: string) => collapseLinks(text, linksRef.current), [])
    const clear = useCallback(() => {
        linksRef.current.clear()
        setLinkSegments([])
    }, [])

    const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return
        const el = e.currentTarget
        const current = selection(el)
        const collapsed = current.start === current.end

        if (e.key === ' ' && collapsed && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const typed = urlBeforeCaret(el.value, current.start)
            if (!typed) return
            e.preventDefault()
            const label = collapseLinks(typed.url, linksRef.current)
            replaceRange(el, { start: typed.start, end: current.start }, `${label}${el.value.slice(typed.end, current.start)} `)
            return
        }

        const deleting = e.key === 'Backspace' || e.key === 'Delete'
        const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey
        if (!deleting && !typing) return
        const tokens = ranges(el.value)
        if (tokens.length === 0) return

        let target: TextRange | undefined
        if (collapsed) {
            if (!deleting) return
            const caret = current.start
            target = e.key === 'Backspace' ? tokens.find(range => range.start < caret && caret <= range.end) : tokens.find(range => range.start <= caret && caret < range.end)
        } else {
            const widened = widen(current, tokens)
            if (widened.start !== current.start || widened.end !== current.end) target = widened
        }
        if (!target) return
        e.preventDefault()
        replaceRange(el, target, deleting ? '' : e.key)
    }, [ranges])

    const onPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
        if (e.defaultPrevented) return
        const pasted = e.clipboardData.getData('text/plain')
        if (!pasted) return
        const collapsed = collapseLinks(pasted, linksRef.current)
        if (collapsed === pasted) return
        e.preventDefault()
        const el = e.currentTarget
        replaceRange(el, widen(selection(el), ranges(el.value)), collapsed)
    }, [ranges])

    const copySelection = useCallback((e: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
        const el = e.currentTarget
        const range = widen(selection(el), ranges(el.value))
        if (range.start === range.end) return
        const selected = el.value.slice(range.start, range.end)
        const expanded = expandLinks(selected, linksRef.current)
        if (expanded === selected && range.start === el.selectionStart && range.end === el.selectionEnd) return
        e.preventDefault()
        e.clipboardData.setData('text/plain', expanded)
        if (cut) replaceRange(el, range, '')
    }, [ranges])
    const onCopy = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => copySelection(e, false), [copySelection])
    const onCut = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => copySelection(e, true), [copySelection])

    const onSelect = useCallback((e: SyntheticEvent<HTMLTextAreaElement>) => {
        const el = e.currentTarget
        const caret = el.selectionStart
        if (caret === el.selectionEnd) {
            const inside = ranges(el.value).find(range => range.start < caret && caret < range.end)
            if (inside) {
                const last = lastCaretRef.current
                const target = last <= inside.start ? inside.end : last >= inside.end ? inside.start : caret - inside.start < inside.end - caret ? inside.start : inside.end
                el.setSelectionRange(target, target)
            }
        }
        lastCaretRef.current = el.selectionStart
    }, [ranges])

    const onScroll = useCallback((e: UIEvent<HTMLTextAreaElement>) => {
        if (mirrorElRef.current) mirrorElRef.current.scrollTop = e.currentTarget.scrollTop
    }, [])

    const attachMirror = useCallback((node: HTMLDivElement | null, textarea: HTMLTextAreaElement | null) => {
        mirrorElRef.current = node
        if (node && textarea) node.scrollTop = textarea.scrollTop
    }, [])

    const unlink = useCallback((el: HTMLTextAreaElement | null, range: TextRange, url: string) => {
        if (el) replaceRange(el, range, url)
    }, [])

    const placeCaret = useCallback((el: HTMLTextAreaElement | null, offset: number) => {
        if (!el) return
        el.focus({ preventScroll: true })
        el.setSelectionRange(offset, offset)
        lastCaretRef.current = offset
    }, [])

    return {
        segments,
        hasTokens: segments.some(segment => segment.kind !== 'text'),
        attachMirror,
        refresh,
        expand,
        collapse,
        clear,
        placeCaret,
        unlink,
        handlers: { onKeyDown, onPaste, onCopy, onCut, onSelect, onScroll },
    }
}
