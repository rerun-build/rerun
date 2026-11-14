import { mergeAttributes, Node } from '@tiptap/core'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

export type FileLinkAttrs = { path: string; name: string }

type FileLinkOptions = { onOpen: (path: string) => void }

export const SHARED_FILE_SCHEME = 'shared:'

export const SHARED_FILE_DRAG_TYPE = 'application/x-rerun-shared-file'

const fileName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export function fileLinkMarkdown({ path, name }: FileLinkAttrs): string {
    const label = name.replace(/([\\[\]])/g, '\\$1')
    const destination = /[\s()<>]/.test(path) ? `<${SHARED_FILE_SCHEME}${path.replace(/>/g, '%3E')}>` : `${SHARED_FILE_SCHEME}${path}`
    return `[${label}](${destination})`
}

function decodePath(href: string): string {
    const raw = href.slice(SHARED_FILE_SCHEME.length)
    try {
        return decodeURI(raw)
    } catch {
        return raw
    }
}

const FILE_GLYPH =
    '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.16,6.25h-3.41c-.552,0-1-.448-1-1V1.852"/><path d="M2.75,14.25V3.75c0-1.105,.895-2,2-2h5.586c.265,0,.52,.105,.707,.293l3.914,3.914c.188,.188,.293,.442,.293,.707v7.586c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2Z"/></svg>'

export const FileLink = Node.create<FileLinkOptions>({
    name: 'fileLink',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,

    addOptions() {
        return { onOpen: () => {} }
    },

    addAttributes() {
        return {
            path: { default: '', parseHTML: element => element.getAttribute('data-file-link') ?? '', renderHTML: attrs => ({ 'data-file-link': attrs.path }) },
            name: { default: '', parseHTML: element => element.textContent || fileName(element.getAttribute('data-file-link') ?? ''), renderHTML: () => ({}) },
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-file-link]' }]
    },

    renderHTML({ node, HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes), (node.attrs as FileLinkAttrs).name]
    },

    renderText({ node }) {
        return fileLinkMarkdown(node.attrs as FileLinkAttrs)
    },

    addNodeView() {
        return ({ node }) => {
            const { path, name } = node.attrs as FileLinkAttrs
            const dom = document.createElement('span')
            dom.dataset.fileLink = path
            dom.title = path
            dom.className =
                'mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-px align-baseline text-[0.9em] font-medium text-foreground transition-colors hover:bg-accent'
            dom.innerHTML = FILE_GLYPH
            const label = document.createElement('span')
            label.textContent = name || fileName(path)
            dom.append(label)
            dom.addEventListener('click', event => {
                event.preventDefault()
                this.options.onOpen(path)
            })
            return { dom }
        }
    },

    addStorage() {
        const markdown: MarkdownNodeSpec = {
            serialize(state, node) {
                state.write(fileLinkMarkdown(node.attrs as FileLinkAttrs))
            },
            parse: {
                updateDOM(element) {
                    for (const anchor of element.querySelectorAll(`a[href^="${SHARED_FILE_SCHEME}"]`)) {
                        const chip = element.ownerDocument.createElement('span')
                        chip.setAttribute('data-file-link', decodePath(anchor.getAttribute('href') ?? ''))
                        chip.textContent = anchor.textContent
                        anchor.replaceWith(chip)
                    }
                },
            },
        }
        return { markdown }
    },
})
