'use client'

import { BrainBoxSelect, BrainTagEditor } from '@/components/brain/BrainItemProperties'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import type { BrainBox } from '@/lib/brain/items'
import { importPathOf, isZip, MAX_IMPORT_FILES, MAX_IMPORT_UNPACKED_BYTES, prepareImport, type ImportFile } from '@/lib/brain/import'
import { entriesFromDataTransfer, entriesFromFileList, type UploadEntry } from '@/lib/files/upload'
import { ArchiveIcon, FileIcon, FolderUpIcon, UploadIcon, XIcon } from '@/lib/icons'
import { formatBytes } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

type BrainImportDialogProps = {
    open: boolean
    defaultSpaceId: string | null
    boxes: BrainBox[]
    suggestions: string[]
    onOpenChange: (open: boolean) => void
    onImport: (files: ImportFile[], tags: string[], spaceId: string | null) => void
}

type Notes = { failed: string[]; tooLarge: string[]; truncated: boolean }

const NO_NOTES: Notes = { failed: [], tooLarge: [], truncated: false }

// Files, .zip archives and folders go in at once; the tags and the Box set here land on every file.
export function BrainImportDialog({ open, defaultSpaceId, boxes, suggestions, onOpenChange, onImport }: BrainImportDialogProps) {
    const t = useTranslations('brain.import')
    const locale = useLocale()
    const [files, setFiles] = useState<ImportFile[]>([])
    const [notes, setNotes] = useState<Notes>(NO_NOTES)
    const [reading, setReading] = useState<string | null>(null)
    const [tags, setTags] = useState<string[]>([])
    const [spaceId, setSpaceId] = useState<string | null>(defaultSpaceId)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const folderInputRef = useRef<HTMLInputElement>(null)
    // Two picks in a row both read before either lands: the second merges into what the first kept.
    const filesRef = useRef<ImportFile[]>([])

    const add = async (entries: UploadEntry[]) => {
        if (!entries.length) return
        setReading(entries.find(entry => isZip(entry.file))?.file.name ?? null)
        const prepared = await prepareImport(entries)
        setReading(null)
        const known = new Set(filesRef.current.map(file => importPathOf(file.entry)))
        const merged = [...filesRef.current, ...prepared.files.filter(file => !known.has(importPathOf(file.entry)))]
        filesRef.current = merged.slice(0, MAX_IMPORT_FILES)
        setFiles(filesRef.current)
        setNotes(previous => ({
            failed: [...previous.failed, ...prepared.failed],
            tooLarge: [...previous.tooLarge, ...prepared.tooLarge],
            truncated: previous.truncated || prepared.truncated || merged.length > MAX_IMPORT_FILES,
        }))
    }

    const remove = (file: ImportFile) => {
        filesRef.current = filesRef.current.filter(other => other !== file)
        setFiles(filesRef.current)
    }

    const pickInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files
        if (picked?.length) void add(entriesFromFileList(picked))
        event.target.value = ''
    }

    const close = () => onOpenChange(false)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
                <DialogHeaderBar icon={UploadIcon} title={t('title')} description={t('description')} />
                <div className="space-y-4">
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={pickInput} />
                    <input ref={folderInputRef} type="file" multiple className="hidden" onChange={pickInput} {...{ webkitdirectory: '' }} />
                    <FileDropzone
                        multiple
                        onFiles={picked => void add(entriesFromFileList(picked))}
                        onDropTransfer={transfer => void entriesFromDataTransfer(transfer).then(add)}
                        overlayLabel={t('dropOverlay')}
                        className="rounded-lg border border-dashed border-border p-5"
                    >
                        <div className="flex flex-col items-center gap-3 text-center">
                            <UploadIcon className="size-5 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">{reading ? t('reading', { name: reading }) : t('drop')}</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                <Button size="sm" variant="outline" disabled={reading !== null} onClick={() => fileInputRef.current?.click()}>
                                    <FileIcon />
                                    {t('chooseFiles')}
                                </Button>
                                <Button size="sm" variant="outline" disabled={reading !== null} onClick={() => folderInputRef.current?.click()}>
                                    <FolderUpIcon />
                                    {t('chooseFolder')}
                                </Button>
                            </div>
                        </div>
                    </FileDropzone>

                    {files.length > 0 && (
                        <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs">
                            {files.map(file => {
                                const path = importPathOf(file.entry)
                                const Glyph = file.archive ? ArchiveIcon : FileIcon
                                return (
                                    <li key={path} className="group/file flex items-center gap-1.5 text-muted-foreground">
                                        <Glyph className="size-3 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate" title={path}>
                                            {file.archive ? t('fromArchive', { archive: file.archive, name: file.label }) : file.label}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => remove(file)}
                                            aria-label={t('remove', { name: file.label })}
                                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover/file:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                                        >
                                            <XIcon className="size-3" />
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}

                    {(notes.failed.length > 0 || notes.tooLarge.length > 0 || notes.truncated) && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                            {notes.failed.map(name => (
                                <p key={`failed:${name}`}>{t('archiveFailed', { name })}</p>
                            ))}
                            {notes.tooLarge.map(name => (
                                <p key={`large:${name}`}>{t('tooLarge', { name, size: formatBytes(MAX_IMPORT_UNPACKED_BYTES, locale) })}</p>
                            ))}
                            {notes.truncated && <p>{t('tooMany', { max: MAX_IMPORT_FILES })}</p>}
                        </div>
                    )}

                    <Field label={t('tags')}>
                        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
                            <BrainTagEditor tags={tags} suggestions={suggestions} onChange={setTags} />
                        </div>
                    </Field>
                    <Field label={t('box')} helperText={t('boxHelp')}>
                        <BrainBoxSelect value={spaceId} boxes={boxes} onChange={setSpaceId} className="w-full" />
                    </Field>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={close}>
                        {t('cancel')}
                    </Button>
                    <Button
                        disabled={files.length === 0 || reading !== null}
                        onClick={() => {
                            onImport(files, tags, spaceId)
                            close()
                        }}
                    >
                        {t('submit', { count: files.length })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
