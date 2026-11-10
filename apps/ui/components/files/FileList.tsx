'use client'

import type { FileEntry } from '@/app/api/_actions/workspace-file.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FileUploadMenu } from '@/components/ui/file-upload-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/files/format'
import { entriesFromDataTransfer, type UploadEntry } from '@/lib/files/upload'
import { DownloadIcon, EllipsisIcon, FileIcon, FolderIcon, PencilIcon, Trash2Icon } from '@/lib/icons'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type DragEvent } from 'react'

type FileListProps = {
    title: string
    // Undefined while the folder is still being listed.
    entries: FileEntry[] | undefined
    onOpen: (entry: FileEntry) => void
    onRename: (name: string, next: string) => void
    onDelete: (name: string) => void
    onDownload: (name: string) => void
    onUpload: (entries: UploadEntry[]) => void
}

function kindLabel(entry: FileEntry, labels: { folder: string; file: string }): string {
    if (entry.type === 'dir') return labels.folder
    const dot = entry.name.lastIndexOf('.')
    return dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : labels.file
}

function RenameField({ name, onSubmit, onCancel }: { name: string; onSubmit: (next: string) => void; onCancel: () => void }) {
    const t = useTranslations('files.list')
    const [value, setValue] = useState(name)
    const ref = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const input = ref.current
        if (!input) return
        input.focus()
        const dot = name.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : name.length)
    }, [name])

    const submit = () => {
        const next = value.trim()
        if (next && next !== name) onSubmit(next)
        else onCancel()
    }

    return (
        <Input
            ref={ref}
            value={value}
            aria-label={t('newName')}
            onChange={event => setValue(event.target.value)}
            onBlur={submit}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') onCancel()
            }}
            className="h-7 px-2 text-sm"
        />
    )
}

function ListSkeleton() {
    return (
        <div className="space-y-1">
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex h-9 items-center gap-3 px-2">
                    <Skeleton className="size-4 rounded" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="ml-auto h-3 w-12" />
                </div>
            ))}
        </div>
    )
}

// A folder of the shared folder as Notion lists a database: the folder name as the page title, one
// line per entry, actions on hover, and the whole page as a drop zone.
export function FileList({ title, entries, onOpen, onRename, onDelete, onDownload, onUpload }: FileListProps) {
    const locale = useLocale()
    const t = useTranslations('files')
    const kindLabels = { folder: t('list.folder'), file: t('list.file') }
    const [renaming, setRenaming] = useState<string | null>(null)
    const [deleting, setDeleting] = useState<FileEntry | null>(null)
    const [dragOver, setDragOver] = useState(false)

    const handleDrop = async (event: DragEvent) => {
        event.preventDefault()
        setDragOver(false)
        const dropped = await entriesFromDataTransfer(event.dataTransfer)
        if (dropped.length) onUpload(dropped)
    }

    const acceptsDrop = (event: DragEvent) => event.dataTransfer.types.includes('Files')

    return (
        <div
            className="relative min-h-0 flex-1 overflow-y-auto"
            onDragOver={event => {
                if (!acceptsDrop(event)) return
                event.preventDefault()
                setDragOver(true)
            }}
            onDragLeave={event => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                setDragOver(false)
            }}
            onDrop={event => void handleDrop(event)}
        >
            {dragOver && (
                <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5">
                    <p className="text-sm font-medium text-primary">{t('list.dropHere')}</p>
                </div>
            )}
            <div className="mx-auto w-full max-w-[900px] px-6 pb-16 pt-8 sm:px-12 sm:pt-12">
                <div className="mb-6 flex items-center gap-3">
                    <h1 className="min-w-0 flex-1 truncate text-[2rem] font-semibold leading-tight tracking-tight">{title}</h1>
                    <FileUploadMenu onPick={onUpload} />
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_5rem_4rem_2rem] items-center gap-x-3 border-b border-border px-2 pb-1.5 text-xs text-muted-foreground max-sm:grid-cols-[minmax(0,1fr)_2rem]">
                    <span>{t('list.name')}</span>
                    <span className="text-right max-sm:hidden">{t('list.size')}</span>
                    <span className="max-sm:hidden">{t('list.type')}</span>
                    <span />
                </div>

                {!entries ? (
                    <ListSkeleton />
                ) : entries.length === 0 ? (
                    <p className="px-2 py-6 text-sm text-muted-foreground">{t('list.empty')}</p>
                ) : (
                    <div className="divide-y divide-border/60">
                        {entries.map(entry => {
                            const Glyph = entry.type === 'dir' ? FolderIcon : FileIcon
                            return (
                                <div
                                    key={entry.name}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => renaming !== entry.name && onOpen(entry)}
                                    onKeyDown={event => event.key === 'Enter' && renaming !== entry.name && onOpen(entry)}
                                    className="group/file grid h-9 cursor-pointer grid-cols-[minmax(0,1fr)_5rem_4rem_2rem] items-center gap-x-3 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 max-sm:grid-cols-[minmax(0,1fr)_2rem]"
                                >
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <Glyph className="size-4 shrink-0 text-muted-foreground" />
                                        {renaming === entry.name ? (
                                            <RenameField
                                                name={entry.name}
                                                onSubmit={next => {
                                                    setRenaming(null)
                                                    onRename(entry.name, next)
                                                }}
                                                onCancel={() => setRenaming(null)}
                                            />
                                        ) : (
                                            <span className="truncate">{entry.name}</span>
                                        )}
                                    </span>
                                    <span className="text-right text-xs tabular-nums text-muted-foreground max-sm:hidden">{entry.type === 'dir' ? '' : formatBytes(entry.size, locale)}</span>
                                    <span className="truncate text-xs text-muted-foreground max-sm:hidden">{kindLabel(entry, kindLabels)}</span>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                size="icon-xs"
                                                variant="ghost"
                                                aria-label={t('list.actionsFor', { name: entry.name })}
                                                onClick={event => event.stopPropagation()}
                                                className="opacity-0 transition-opacity group-hover/file:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                                            >
                                                <EllipsisIcon />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" onClick={event => event.stopPropagation()}>
                                            {entry.type !== 'dir' && (
                                                <DropdownMenuItem onSelect={() => onDownload(entry.name)}>
                                                    <DownloadIcon /> {t('grid.download')}
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onSelect={() => setRenaming(entry.name)}>
                                                <PencilIcon /> {t('grid.rename')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(entry)}>
                                                <Trash2Icon /> {t('grid.delete')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={open => !open && setDeleting(null)}
                title={t('delete.title', { name: deleting?.name ?? '' })}
                description={deleting?.type === 'dir' ? t('delete.folder') : t('delete.file')}
                onConfirm={() => {
                    if (deleting) onDelete(deleting.name)
                    setDeleting(null)
                }}
            />
        </div>
    )
}
