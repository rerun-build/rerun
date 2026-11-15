import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

export type WikilinkAttrs = { target: string; label: string | null }

type WikilinkOptions = {
    titleOf: (slug: string) => string | undefined
    onOpen: (slug: string) => void
}

type InlineState = { src: string; pos: number; push: (type: string, tag: string, nesting: number) => { meta: unknown } }
type MarkdownIt = {
    inline: { ruler: { before: (name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean) => void } }
    renderer: { rules: Record<string, (tokens: { meta: WikilinkAttrs }[], index: number) => string> }
}

const WIKILINK_AT_START = /^\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/
const WIKILINK_TYPED = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]$/

export const wikilinkSlug = (target: string) => target.split('#')[0].trim().toLowerCase()

export const wikilinkMarkdown = ({ target, label }: WikilinkAttrs) => `[[${target}${label ? `|${label}` : ''}]]`

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const installed = new WeakSet<object>()

function installWikilinkRule(md: MarkdownIt) {
    if (installed.has(md)) return
    installed.add(md)
    md.inline.ruler.before('link', 'wikilink', (state, silent) => {
        if (!state.src.startsWith('[[', state.pos)) return false
        const match = WIKILINK_AT_START.exec(state.src.slice(state.pos))
        if (!match) return false
        if (!silent) state.push('wikilink', '', 0).meta = { target: match[1].trim(), label: match[2]?.trim() || null }
        state.pos += match[0].length
        return true
    })
    md.renderer.rules.wikilink = (tokens, index) => {
        const { target, label } = tokens[index].meta
        return `<span data-wikilink="${escapeAttribute(target)}"${label ? ` data-label="${escapeAttribute(label)}"` : ''}></span>`
    }
}

export const Wikilink = Node.create<WikilinkOptions>({
    name: 'wikilink',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
        return { titleOf: () => undefined, onOpen: () => {} }
    },

    addAttributes() {
        return {
            target: { default: '', parseHTML: element => element.getAttribute('data-wikilink') ?? '', renderHTML: attrs => ({ 'data-wikilink': attrs.target }) },
            label: { default: null, parseHTML: element => element.getAttribute('data-label'), renderHTML: attrs => (attrs.label ? { 'data-label': attrs.label } : {}) },
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-wikilink]' }]
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as WikilinkAttrs
        return ['span', mergeAttributes(HTMLAttributes), attrs.label || this.options.titleOf(wikilinkSlug(attrs.target)) || attrs.target]
    },

    renderText({ node }) {
        return wikilinkMarkdown(node.attrs as WikilinkAttrs)
    },

    addNodeView() {
        return ({ node }) => {
            const attrs = node.attrs as WikilinkAttrs
            const slug = wikilinkSlug(attrs.target)
            const title = this.options.titleOf(slug)
            const dom = document.createElement('span')
            dom.dataset.wikilink = attrs.target
            dom.textContent = attrs.label || title || attrs.target
            dom.className = title
                ? 'cursor-pointer font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground'
                : 'cursor-pointer text-muted-foreground underline decoration-dashed decoration-muted-foreground/40 underline-offset-2'
            dom.addEventListener('click', event => {
                event.preventDefault()
                this.options.onOpen(slug)
            })
            return { dom }
        }
    },

    addInputRules() {
        return [nodeInputRule({ find: WIKILINK_TYPED, type: this.type, getAttributes: match => ({ target: match[1].trim(), label: match[2]?.trim() || null }) })]
    },

    addStorage() {
        const markdown: MarkdownNodeSpec = {
            serialize(state, node) {
                state.write(wikilinkMarkdown(node.attrs as WikilinkAttrs))
            },
            parse: {
                setup(md) {
                    installWikilinkRule(md as unknown as MarkdownIt)
                },
            },
        }
        return { markdown }
    },
})
