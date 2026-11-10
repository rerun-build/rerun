'use client'

import { deleteWorkspaceFileAction, readWorkspaceFileAction, renameWorkspaceFileAction, writeWorkspaceFileAction } from '@/app/api/_actions/workspace-file.actions'
import type { BrainSelection } from '@/components/brain/selection'
import { BrainTopBar, type BrainCrumb } from '@/components/brain/BrainTopBar'
import { joinPath, parentPath, type SharedFilesTree } from '@/components/brain/useSharedFilesTree'
import { FileDetail } from '@/components/files/FileDetail'
import { FileList } from '@/components/files/FileList'
import { useSiblingFiles } from '@/components/files/useSiblingFiles'
import { sharedFileRawUrl } from '@/lib/files/raw-url'
import type { UploadEntry } from '@/lib/files/upload'
import { FileIcon, FolderIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'

function folderCrumbs(path: string, rootLabel: string, onSelect: (selection: BrainSelection) => void): BrainCrumb[] {
    const parts = path.split('/').filter(Boolean)
    return [
        { label: rootLabel, icon: FolderIcon, onClick: () => onSelect({ kind: 'folder', path: '' }) },
        ...parts.map((part, index) => ({ label: part, onClick: () => onSelect({ kind: 'folder', path: parts.slice(0, index + 1).join('/') }) })),
    ]
}

function download(path: string) {
    const anchor = document.createElement('a')
    anchor.href = sharedFileRawUrl(path)
    anchor.download = path.split('/').pop() ?? path
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
}

type FolderProps = { path: string; files: SharedFilesTree; onSelect: (selection: BrainSelection) => void; onUpload: (entries: UploadEntry[], dir: string) => void }

export function BrainFolderView({ path, files, onSelect, onUpload }: FolderProps) {
    const t = useTranslations('brain.files')
    const { expand, refresh } = files

    useEffect(() => {
        if (path) expand(path)
    }, [path, expand])

    const rename = async (name: string, next: string) => {
        try {
            await renameWorkspaceFileAction(joinPath(path, name), joinPath(path, next))
        } catch {
            toast.error(t('renameFailed', { name }))
        }
        await refresh(path)
    }

    const remove = async (name: string) => {
        try {
            await deleteWorkspaceFileAction(joinPath(path, name))
        } catch {
            toast.error(t('deleteFailed', { name }))
        }
        await refresh(path)
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={folderCrumbs(path, t('root'), onSelect)} />
            <FileList
                title={path.split('/').filter(Boolean).pop() ?? t('root')}
                entries={files.entriesOf(path)}
                onOpen={entry => onSelect({ kind: entry.type === 'dir' ? 'folder' : 'file', path: joinPath(path, entry.name) })}
                onRename={(name, next) => void rename(name, next)}
                onDelete={name => void remove(name)}
                onDownload={name => download(joinPath(path, name))}
                onUpload={entries => onUpload(entries, path)}
            />
        </div>
    )
}

type FileProps = { path: string; files: SharedFilesTree; onSelect: (selection: BrainSelection) => void }

export function BrainFileView({ path, files, onSelect }: FileProps) {
    const t = useTranslations('brain.files')
    const dir = parentPath(path)
    const name = path.split('/').pop() ?? path
    const { expand, refresh } = files

    useEffect(() => {
        expand(dir)
    }, [dir, expand])

    const openSibling = useCallback((sibling: string) => onSelect({ kind: 'file', path: joinPath(dir, sibling) }), [dir, onSelect])
    const siblings = useSiblingFiles({ entries: files.entriesOf(dir) ?? [], openName: name, onOpen: openSibling })

    const readFile = useCallback((filePath: string) => readWorkspaceFileAction(filePath), [])
    const writeFile = useCallback((filePath: string, content: string, baseHash: string | null) => writeWorkspaceFileAction(filePath, content, baseHash), [])

    const remove = async () => {
        try {
            await deleteWorkspaceFileAction(path)
        } catch {
            toast.error(t('deleteFailed', { name }))
            return
        }
        await refresh(dir)
        onSelect({ kind: 'folder', path: dir })
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={[...folderCrumbs(dir, t('root'), onSelect), { label: name, icon: FileIcon }]} />
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
                <FileDetail
                    name={name}
                    path={path}
                    rawUrl={sharedFileRawUrl(path)}
                    readFile={readFile}
                    siblings={siblings}
                    onBack={() => onSelect({ kind: 'folder', path: dir })}
                    onDownload={() => download(path)}
                    onDelete={() => void remove()}
                    writeFile={writeFile}
                    onSaved={() => void refresh(dir)}
                />
            </div>
        </div>
    )
}
