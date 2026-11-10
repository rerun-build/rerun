'use client'

import type { AgentArchiveEntry } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { formatBytes } from '@/lib/files/format'
import { ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'

type TreeNode = {
    name: string
    path: string
    bytes: number
    file: AgentArchiveEntry | null
    children: TreeNode[]
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes
        .sort((a, b) => (a.file === null) === (b.file === null) ? a.name.localeCompare(b.name) : a.file === null ? -1 : 1)
        .map(node => ({ ...node, children: sortNodes(node.children) }))
}

function buildTree(files: AgentArchiveEntry[]): TreeNode[] {
    const root: TreeNode = { name: '', path: '', bytes: 0, file: null, children: [] }
    for (const file of files) {
        const parts = file.path.split('/')
        let node = root
        for (let depth = 0; depth < parts.length; depth++) {
            const path = parts.slice(0, depth + 1).join('/')
            let child = node.children.find(candidate => candidate.path === path)
            if (!child) {
                child = { name: parts[depth], path, bytes: 0, file: depth === parts.length - 1 ? file : null, children: [] }
                node.children.push(child)
            }
            child.bytes += file.bytes
            node = child
        }
    }
    return sortNodes(root.children)
}

function leavesOf(node: TreeNode, out: AgentArchiveEntry[] = []): AgentArchiveEntry[] {
    if (node.file) out.push(node.file)
    for (const child of node.children) leavesOf(child, out)
    return out
}

// A folder is worth opening on arrival when it hides something the admin has to arbitrate.
function pathsToFlagged(nodes: TreeNode[], open: Set<string> = new Set()): Set<string> {
    for (const node of nodes) {
        if (node.file) continue
        if (leavesOf(node).some(file => file.flagged.length > 0)) {
            open.add(node.path)
            pathsToFlagged(node.children, open)
        }
    }
    return open
}

export function CaptureFileTree({
    files,
    excluded,
    onToggle,
}: {
    files: AgentArchiveEntry[]
    excluded: string[]
    onToggle: (paths: string[], keep: boolean) => void
}) {
    const tree = React.useMemo(() => buildTree(files), [files])
    const [open, setOpen] = React.useState<Set<string>>(() => pathsToFlagged(tree))

    return (
        <div className="rounded-md border border-border/60 p-1">
            {tree.map(node => (
                <TreeRow key={node.path} node={node} depth={0} open={open} setOpen={setOpen} excluded={excluded} onToggle={onToggle} />
            ))}
        </div>
    )
}

function TreeRow({
    node,
    depth,
    open,
    setOpen,
    excluded,
    onToggle,
}: {
    node: TreeNode
    depth: number
    open: Set<string>
    setOpen: React.Dispatch<React.SetStateAction<Set<string>>>
    excluded: string[]
    onToggle: (paths: string[], keep: boolean) => void
}) {
    const t = useTranslations('templates.capture.tree')
    const locale = useLocale()
    const leaves = React.useMemo(() => leavesOf(node), [node])
    const kept = leaves.filter(file => !excluded.includes(file.path))
    const checked = kept.length === leaves.length ? true : kept.length === 0 ? false : 'indeterminate'
    const flaggedCount = leaves.filter(file => file.flagged.length > 0).length
    const isOpen = open.has(node.path)

    function toggleOpen() {
        setOpen(current => {
            const next = new Set(current)
            if (!next.delete(node.path)) next.add(node.path)
            return next
        })
    }

    // A half-kept folder resolves to "keep everything", so one click always has an obvious effect.
    function toggleSelf() {
        onToggle(
            leaves.map(file => file.path),
            checked !== true,
        )
    }

    return (
        <>
            <div className="flex items-center gap-2 rounded py-1 pr-1 hover:bg-muted/40" style={{ paddingLeft: `${depth * 0.875 + 0.25}rem` }}>
                <Checkbox size="sm" checked={checked} onCheckedChange={toggleSelf} />
                {node.file ? (
                    <span className="w-3.5 shrink-0" />
                ) : (
                    <button type="button" onClick={toggleOpen} className="shrink-0 text-muted-foreground" aria-label={isOpen ? t('collapse') : t('expand')}>
                        <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                    </button>
                )}
                <span className={cn('min-w-0 flex-1 truncate font-mono text-xs', node.file ? '' : 'text-muted-foreground')}>
                    {node.name}
                    {node.file ? '' : '/'}
                </span>
                {node.file?.note && !node.file.flagged.length && <span className="shrink-0 text-[0.65rem] text-muted-foreground">{node.file.note}</span>}
                {flaggedCount > 0 && (
                    <span className="shrink-0 text-[0.65rem] text-destructive">
                        {node.file ? node.file.flagged.join(', ') : t('flagged', { count: flaggedCount })}
                    </span>
                )}
                <span className="w-14 shrink-0 text-right text-[0.65rem] text-muted-foreground">{formatBytes(node.bytes, locale)}</span>
            </div>

            {!node.file &&
                isOpen &&
                node.children.map(child => (
                    <TreeRow key={child.path} node={child} depth={depth + 1} open={open} setOpen={setOpen} excluded={excluded} onToggle={onToggle} />
                ))}
        </>
    )
}
