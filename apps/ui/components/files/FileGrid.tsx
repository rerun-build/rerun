'use client'

import type { FileEntry } from '@/app/api/_actions/workspace-file.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { formatBytes } from '@/lib/files/format'
import { ChevronUpIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, GlobeIcon, PencilIcon, Trash2Icon } from '@/lib/icons'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

import { FolderGlyph, GLYPH_INK_MUTED } from './FileGlyph'
import { FileThumbnail } from './FileThumbnail'
import { FileTile } from './FileTile'
import { sortFileEntries } from './sort-file-entries'
import { useFileThumbnails } from './useFileThumbnails'

type FileGridProps = {
    entries: FileEntry[]
    currentPath: string
    rawUrlFor: (path: string) => string
    readTextHead: (path: string) => Promise<string>
    onNavigate: (name: string) => void
    onSelectFile: (name: string) => void
    onGoUp?: () => void
    onDelete: (name: string) => void
    onRename: (oldName: string, newName: string) => void
    onDownload: (name: string) => void
    // Publishing (agent files only): map of file or folder name (in the current dir) to its public
    // URL when published, plus publish/unpublish handlers. A published folder is served as a site.
    // Omitted for space/shared files.
    publishedByName?: Record<string, string>
    onPublish?: (name: string) => Promise<void>
    onUnpublish?: (name: string) => Promise<void>
    // Bumped when a file is saved: the thumbnail cache is keyed on the directory alone, which does
    // not change when its content does.
    contentRevision?: number
}

export function FileGrid({
    entries,
    currentPath,
    rawUrlFor,
    readTextHead,
    onNavigate,
    onSelectFile,
    onGoUp,
    onDelete,
    onRename,
    onDownload,
    publishedByName,
    onPublish,
    onUnpublish,
    contentRevision = 0,
}: FileGridProps) {
    const locale = useLocale()
    const t = useTranslations('files')
    const [target, setTarget] = useState<string | null>(null)
    const [renaming, setRenaming] = useState<string | null>(null)
    const [confirming, setConfirming] = useState<{ name: string; action: 'delete' | 'unshare' } | null>(null)
    const { heads, request } = useFileThumbnails({ read: readTextHead, resetKey: `${currentPath}#${contentRevision}` })

    const sorted = useMemo(() => sortFileEntries(entries), [entries])

    const pathOf = useCallback((name: string) => (currentPath ? `${currentPath}/${name}` : name), [currentPath])

    const menuEntry = target ? sorted.find(entry => entry.name === target) : undefined
    const menuUrl = menuEntry ? publishedByName?.[menuEntry.name] : undefined

    return (
        <>
            <ContextMenu onOpenChange={open => !open && setTarget(null)}>
                <ContextMenuTrigger asChild>
                    <div className="grid content-start gap-1 p-3 [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))]">
                        {currentPath && onGoUp && (
                            <FileTile
                                name=".."
                                title={t('grid.parentDirectory')}
                                onOpen={onGoUp}
                                glyph={
                                    <FolderGlyph>
                                        <ChevronUpIcon className="absolute left-1/2 top-[27px] size-5 -translate-x-1/2" style={{ color: GLYPH_INK_MUTED }} />
                                    </FolderGlyph>
                                }
                            />
                        )}
                        {sorted.map(entry => (
                            <FileTile
                                key={entry.name}
                                name={entry.name}
                                title={entry.type === 'dir' ? entry.name : `${entry.name} — ${formatBytes(entry.size, locale)}`}
                                published={Boolean(publishedByName?.[entry.name])}
                                renaming={renaming === entry.name}
                                onOpen={() => (entry.type === 'dir' ? onNavigate(entry.name) : onSelectFile(entry.name))}
                                onContextMenu={() => setTarget(entry.name)}
                                onRenameSubmit={next => {
                                    setRenaming(null)
                                    onRename(entry.name, next)
                                }}
                                onRenameCancel={() => setRenaming(null)}
                                glyph={
                                    <FileThumbnail
                                        entry={entry}
                                        path={pathOf(entry.name)}
                                        rawUrl={rawUrlFor(pathOf(entry.name))}
                                        textHead={heads[pathOf(entry.name)]}
                                        onRequestText={request}
                                    />
                                }
                            />
                        ))}
                    </div>
                </ContextMenuTrigger>
                {menuEntry && (
                    <ContextMenuContent>
                        <ContextMenuLabel className="max-w-56 truncate pl-7">{menuEntry.name}</ContextMenuLabel>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="pl-7" onSelect={() => (menuEntry.type === 'dir' ? onNavigate(menuEntry.name) : onSelectFile(menuEntry.name))}>
                            {menuEntry.type === 'dir' ? t('grid.openFolder') : t('grid.open')}
                        </ContextMenuItem>
                        {menuEntry.type !== 'dir' && (
                            <ContextMenuItem onSelect={() => onDownload(menuEntry.name)}>
                                <DownloadIcon className="size-4" />
                                {t('grid.download')}
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem onSelect={() => setRenaming(menuEntry.name)}>
                            <PencilIcon className="size-4" />
                            {t('grid.rename')}
                        </ContextMenuItem>
                        {(onPublish || menuUrl) && <ContextMenuSeparator />}
                        {menuUrl ? (
                            <>
                                <ContextMenuLabel className="pl-7">{t('publish.publicLink')}</ContextMenuLabel>
                                <ContextMenuItem onSelect={() => window.open(menuUrl, '_blank', 'noopener,noreferrer')}>
                                    <ExternalLinkIcon className="size-4" />
                                    {t('publish.openPublicLink')}
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => navigator.clipboard.writeText(menuUrl)}>
                                    <CopyIcon className="size-4" />
                                    {t('publish.copyPublicLink')}
                                </ContextMenuItem>
                                <ContextMenuItem variant="destructive" className="pl-7" onSelect={() => setConfirming({ name: menuEntry.name, action: 'unshare' })}>
                                    {t('publish.unshare')}
                                </ContextMenuItem>
                            </>
                        ) : (
                            onPublish && (
                                <ContextMenuItem onSelect={() => void onPublish(menuEntry.name)}>
                                    <GlobeIcon className="size-4" />
                                    {t('publish.publishPublicly')}
                                </ContextMenuItem>
                            )
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onSelect={() => setConfirming({ name: menuEntry.name, action: 'delete' })}>
                            <Trash2Icon className="size-4" />
                            {t('grid.delete')}
                        </ContextMenuItem>
                    </ContextMenuContent>
                )}
            </ContextMenu>
            {confirming?.action === 'delete' && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirming(null)}
                    title={t('delete.title', { name: confirming.name })}
                    description={
                        entries.find(entry => entry.name === confirming.name)?.type === 'dir'
                            ? t('delete.folder')
                            : t('delete.file')
                    }
                    onConfirm={() => {
                        onDelete(confirming.name)
                        setConfirming(null)
                    }}
                />
            )}
            {confirming?.action === 'unshare' && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirming(null)}
                    title={t('publish.unshareTitle', { name: confirming.name })}
                    description={t('publish.unshareDescription')}
                    confirmLabel={t('publish.unshare')}
                    onConfirm={() => {
                        void onUnpublish?.(confirming.name)
                        setConfirming(null)
                    }}
                />
            )}
        </>
    )
}
