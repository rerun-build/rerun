import type { KnowledgeBaseTab } from '@/lib/settings/panels'

export type BrainSelection =
    | { kind: 'page'; slug: string }
    | { kind: 'history'; slug: string }
    | { kind: 'new-page' }
    | { kind: 'proposals' }
    | { kind: 'published' }
    | { kind: 'folder'; path: string }
    | { kind: 'file'; path: string }
    // The database before a table is picked: lands on its first table, or says there is none yet.
    | { kind: 'database' }
    | { kind: 'table'; name: string }

export function selectionKey(selection: BrainSelection | null): string {
    if (!selection) return 'none'
    switch (selection.kind) {
        case 'page':
        case 'history':
            return `${selection.kind}:${selection.slug}`
        case 'folder':
        case 'file':
            return `${selection.kind}:${selection.path}`
        case 'table':
            return `table:${selection.name}`
        default:
            return selection.kind
    }
}

// How far the main panel has drilled in, so a step back slides the other way.
export function selectionDepth(selection: BrainSelection | null): number {
    if (!selection) return 0
    if (selection.kind === 'history') return 1
    if (selection.kind === 'folder') return selection.path.split('/').filter(Boolean).length
    if (selection.kind === 'file') return selection.path.split('/').filter(Boolean).length + 1
    return 0
}

// The tabs the rest of the app still opens the Brain on.
export function selectionForTab(tab: KnowledgeBaseTab): BrainSelection | null {
    if (tab === 'proposals') return { kind: 'proposals' }
    if (tab === 'published') return { kind: 'published' }
    if (tab === 'files') return { kind: 'folder', path: '' }
    if (tab === 'database') return { kind: 'database' }
    return null
}
