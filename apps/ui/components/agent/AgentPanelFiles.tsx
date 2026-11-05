'use client'

import { deleteFileAction, readFileAction, readFileHeadAction, renameFileAction, writeFileAction } from '@/app/api/_actions/file.actions'
import { listPublishedAction, publishFileAction, unpublishFileAction } from '@/app/api/_actions/publish.actions'
import { agentFileRawUrl } from '@/lib/files/raw-url'
import { entriesFromDataTransfer } from '@/lib/files/upload'
import type { PublishedFile } from '@/lib/services/types'
import { ChevronRightIcon, EyeIcon, EyeOffIcon, HomeIcon, RefreshCwIcon } from '@/lib/icons'
import { SkeletonFileGrid } from '@/components/ui/skeleton'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileUploadMenu } from '@/components/ui/file-upload-menu'
import { PanelSteps } from '@/components/ui/panel-steps'
import { UploadTray } from '@/components/ui/upload-tray'
import { usePanelUploads } from '@/hooks/usePanelUploads'
import { useAgentFileNavigation } from '@/components/agent/useAgentFileNavigation'
import { FileDetail } from '@/components/files/FileDetail'
import { FileGrid } from '@/components/files/FileGrid'
import { FilesEmptyState } from '@/components/files/FilesEmptyState'
import { useSiblingFiles } from '@/components/files/useSiblingFiles'
import { usePublishedAccessEnabled } from '@/components/layout/FeatureFlagsProvider'
import { ShareDialog } from '@/components/published/ShareDialog'
import { openPublishedHref } from '@/lib/published/links'
import { toast } from 'sonner'

type AgentPanelFilesProps = {
    agentId: string
    focusPath?: string | null
    onFocusConsumed?: () => void
}

export function AgentPanelFiles({ agentId, focusPath, onFocusConsumed }: AgentPanelFilesProps) {
    const [openFile, setOpenFile] = useState<{ path: string; name: string } | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [published, setPublished] = useState<PublishedFile[]>([])
    const [contentRevision, setContentRevision] = useState(0)
    const publishedAccess = usePublishedAccessEnabled()
    const [sharingSlug, setSharingSlug] = useState<string | null>(null)

    const rawUrlFor = useCallback((filePath: string) => agentFileRawUrl(agentId, filePath), [agentId])

    const readTextHead = useCallback((filePath: string) => readFileHeadAction(agentId, filePath), [agentId])

    const readFile = useCallback((filePath: string) => readFileAction(agentId, filePath), [agentId])

    const writeFile = useCallback((filePath: string, content: string, baseHash: string | null) => writeFileAction(agentId, filePath, content, baseHash), [agentId])

    const openFileAtPath = useCallback((filePath: string, name: string) => setOpenFile({ path: filePath, name }), [])

    const { currentPath, entries, depth, loading, busy, showHidden, navigate, enter, goUp, goHome, setShowHidden, reload } = useAgentFileNavigation({
        agentId,
        focusPath,
        onFocusConsumed,
        onOpenFile: openFileAtPath,
    })

    const uploads = usePanelUploads({
        target: useMemo(() => ({ kind: 'agent', agentId }) as const, [agentId]),
        currentPath,
        onDirectoryChanged: reload,
    })

    const loadPublished = useCallback(async () => {
        setPublished(await listPublishedAction(agentId))
    }, [agentId])

    useEffect(() => {
        let cancelled = false
        void listPublishedAction(agentId).then(files => {
            if (!cancelled) setPublished(files)
        })
        return () => {
            cancelled = true
        }
    }, [agentId])

    // Files in the CURRENT directory that are published → name → their link. Published files
    // are tracked by their full workspace path, so match the part before the last slash.
    const publishedFileByName = useMemo(() => {
        const map: Record<string, PublishedFile> = {}
        for (const f of published) {
            const slash = f.path.lastIndexOf('/')
            const dir = slash === -1 ? '' : f.path.slice(0, slash)
            const name = slash === -1 ? f.path : f.path.slice(slash + 1)
            if (dir === currentPath) map[name] = f
        }
        return map
    }, [published, currentPath])
    const publishedByName = useMemo(() => Object.fromEntries(Object.entries(publishedFileByName).map(([name, file]) => [name, file.url])), [publishedFileByName])

    const handlePublish = useCallback(async (name: string) => {
        const filePath = currentPath ? `${currentPath}/${name}` : name
        const result = await publishFileAction(agentId, filePath)
        if (!result.success) {
            toast.error(`Could not publish ${name}`, { description: result.error })
            return
        }
        await loadPublished()
        // A new link starts with the access the workspace gives it: the share dialog is where it changes.
        if (publishedAccess && result.slug) setSharingSlug(result.slug)
    }, [agentId, currentPath, loadPublished, publishedAccess])

    const handleUnpublish = useCallback(async (name: string) => {
        const filePath = currentPath ? `${currentPath}/${name}` : name
        const target = published.find(p => p.path === filePath)
        if (!target) return
        await unpublishFileAction(agentId, target.slug)
        await loadPublished()
    }, [agentId, currentPath, published, loadPublished])

    const handleSelectFile = useCallback((name: string) => {
        openFileAtPath(currentPath ? `${currentPath}/${name}` : name, name)
    }, [currentPath, openFileAtPath])

    const siblings = useSiblingFiles({ entries, openName: openFile?.name, onOpen: handleSelectFile })

    const handleDownload = useCallback((name: string) => {
        const a = document.createElement('a')
        a.href = rawUrlFor(currentPath ? `${currentPath}/${name}` : name)
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
    }, [currentPath, rawUrlFor])

    const handleDelete = useCallback(async (name: string) => {
        const filePath = currentPath ? `${currentPath}/${name}` : name
        try {
            await deleteFileAction(agentId, filePath)
            setOpenFile(prev => (prev?.name === name ? null : prev))
            reload()
        } catch {
        }
    }, [agentId, currentPath, reload])

    const handleRename = useCallback(async (oldName: string, newName: string) => {
        const oldPath = currentPath ? `${currentPath}/${oldName}` : oldName
        const newPath = currentPath ? `${currentPath}/${newName}` : newName
        try {
            await renameFileAction(agentId, oldPath, newPath)
            reload()
        } catch {
        }
    }, [agentId, currentPath, reload])

    const handleSaved = useCallback(() => {
        setContentRevision(n => n + 1)
        reload()
    }, [reload])

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault()
            setDragOver(false)
            const entries = await entriesFromDataTransfer(e.dataTransfer)
            if (entries.length) uploads.enqueue(entries, currentPath)
        },
        [currentPath, uploads]
    )

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
    }, [])

    const breadcrumbs = currentPath.split('/').filter(Boolean)

    return (
        <div className="relative flex h-full flex-col">
            <PanelSteps stepKey={openFile ? 'file' : 'list'} depth={openFile ? 1 : 0}>
                {openFile ? (
                    <FileDetail
                        name={openFile.name}
                        path={openFile.path}
                        rawUrl={rawUrlFor(openFile.path)}
                        readFile={readFile}
                        siblings={siblings}
                        onBack={() => setOpenFile(null)}
                        onDownload={() => handleDownload(openFile.name)}
                        onDelete={() => void handleDelete(openFile.name)}
                        writeFile={writeFile}
                        onSaved={handleSaved}
                        publicUrl={publishedByName[openFile.name]}
                        onPublish={() => void handlePublish(openFile.name)}
                        onUnpublish={() => void handleUnpublish(openFile.name)}
                        onShareSettings={publishedAccess && publishedFileByName[openFile.name] ? () => setSharingSlug(publishedFileByName[openFile.name].slug) : undefined}
                        openUrl={publishedAccess && publishedFileByName[openFile.name] ? openPublishedHref(publishedFileByName[openFile.name].slug) : undefined}
                    />
                ) : (
                    <div
                        className={`flex min-h-0 flex-1 flex-col ${dragOver ? 'ring-2 ring-inset ring-primary/50' : ''}`}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                    >
                        {dragOver && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 pointer-events-none">
                                <p className="text-sm font-medium text-primary">Drop files or folders to upload</p>
                            </div>
                        )}
                        <div className="flex items-center gap-1 px-3 py-2 border-b border-border text-xs overflow-x-auto">
                            <button onClick={goHome} className="shrink-0 p-1 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground">
                                <HomeIcon className="size-3.5" />
                            </button>
                            {breadcrumbs.map((crumb, i) => (
                                <span key={i} className="flex items-center gap-1 shrink-0">
                                    <ChevronRightIcon className="size-3 text-muted-foreground" />
                                    <button onClick={() => navigate(breadcrumbs.slice(0, i + 1).join('/'))} className="hover:text-foreground text-muted-foreground transition-colors">
                                        {crumb}
                                    </button>
                                </span>
                            ))}
                            <div className="flex-1" />
                            <FileUploadMenu onPick={entries => uploads.enqueue(entries, currentPath)} />
                            <button
                                onClick={() => setShowHidden(v => !v)}
                                className={`shrink-0 p-1 rounded hover:bg-accent/50 transition-colors ${showHidden ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                            >
                                {showHidden ? <EyeIcon className="size-3.5" /> : <EyeOffIcon className="size-3.5" />}
                            </button>
                            <button onClick={reload} className="shrink-0 p-1 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground">
                                <RefreshCwIcon className="size-3.5" />
                            </button>
                        </div>

                        <PanelSteps stepKey={`dir:${currentPath}`} depth={depth}>
                            <div className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
                                {loading ? (
                                    <div className="flex-1 overflow-y-auto">
                                        <SkeletonFileGrid tiles={10} />
                                    </div>
                                ) : entries.length === 0 ? (
                                    <FilesEmptyState
                                        description="This is your coworker's workspace. Files it downloads, creates or edits during its runs are stored here."
                                        onGoUp={currentPath ? goUp : undefined}
                                    />
                                ) : (
                                    <div className="flex-1 overflow-y-auto">
                                        <FileGrid
                                            entries={entries}
                                            currentPath={currentPath}
                                            rawUrlFor={rawUrlFor}
                                            readTextHead={readTextHead}
                                            onNavigate={enter}
                                            onSelectFile={handleSelectFile}
                                            onGoUp={goUp}
                                            onDelete={handleDelete}
                                            onRename={handleRename}
                                            onDownload={handleDownload}
                                            contentRevision={contentRevision}
                                            publishedByName={publishedByName}
                                            onPublish={handlePublish}
                                            onUnpublish={handleUnpublish}
                                        />
                                    </div>
                                )}
                            </div>
                        </PanelSteps>
                    </div>
                )}
            </PanelSteps>
            <UploadTray items={uploads.items} totalProgress={uploads.totalProgress} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.active ? uploads.cancelAll : uploads.clearFinished} />
            {publishedAccess && (
                <ShareDialog
                    open={sharingSlug !== null}
                    onOpenChange={open => !open && setSharingSlug(null)}
                    slug={sharingSlug}
                    initial={published.find(file => file.slug === sharingSlug) ?? null}
                    onChanged={() => void loadPublished()}
                    onUnpublished={() => void loadPublished()}
                />
            )}
        </div>
    )
}
