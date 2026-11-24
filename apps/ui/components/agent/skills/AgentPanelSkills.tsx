'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { importSkillAction, listSkillsAction } from '@/app/api/_actions/agent.actions'
import { listBrainSkillsAction, shareSkillToBrainAction } from '@/app/api/_actions/brain.actions'
import { invalidateAllAgentSkillSummaries, setAgentSkillSummaries } from '@/hooks/useAgentSkillSummaries'
import { SkillEditor } from '@/components/agent/skills/SkillEditor'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import type { EngineSkillWithSource } from '@/lib/engine/types'
import { brainAuthorLabel } from '@/lib/brain/labels'
import { coworkerOfAuthor, type BrainCoworker } from '@/lib/brain/items'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import type { BrainSkill } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { BlocksIcon, BrainIcon, FileTextIcon, FolderUpIcon, Layers, Loader2Icon, PlusIcon, Share2Icon, UploadIcon } from '@/lib/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { Badge } from '@rerun/ui/primitives'
import { MAX_SKILL_FILE_BYTES, readSkillFolders } from '@/lib/skills/folder-import'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type AgentPanelSkillsProps = {
    agentId: string
    agentName: string
    focusSlug?: string | null
    onFocusConsumed?: () => void
}

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; slug: string; readOnly: boolean }

export function AgentPanelSkills({ agentId, agentName, focusSlug, onFocusConsumed }: AgentPanelSkillsProps) {
    const t = useTranslations('agent.agentPanelSkills')
    const tBrain = useTranslations('brain')
    const openBrainSkill = useWorkspaceSettingsStore(s => s.openBrainSkill)
    const errorText = useErrorText()
    const boxManageReason = useBoxManageReason(agentId)
    const [skills, setSkills] = useState<EngineSkillWithSource[]>([])
    // The Brain's skills the coworker uses: one of its own under the same slug wins over it.
    const [brainSkills, setBrainSkills] = useState<BrainSkill[]>([])
    const [coworkers, setCoworkers] = useState<BrainCoworker[]>([])
    // False on a box from before the Brain's skills: there is nowhere to move one to.
    const [brainAvailable, setBrainAvailable] = useState(false)
    const [confirmingShare, setConfirmingShare] = useState<EngineSkillWithSource | null>(null)
    const [sharing, setSharing] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<View>({ mode: 'list' })
    const [importing, setImporting] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)
    const [importNotice, setImportNotice] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const folderInputRef = useRef<HTMLInputElement>(null)
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason

    // Kept in refs rather than in load's deps: the slug is honoured once, and the callback comes
    // inline from the panel, so a fresh identity on every render would refetch forever.
    const requestedSlugRef = useRef(focusSlug ?? null)
    const consumeRequestedRef = useRef(onFocusConsumed)
    useEffect(() => {
        consumeRequestedRef.current = onFocusConsumed
    })

    const load = useCallback(async () => {
        setLoading(true)
        const [list, brain] = await Promise.all([listSkillsAction(agentId), listBrainSkillsAction()])
        const own = new Set(list.map(skill => skill.slug))
        const fromBrain = (brain?.skills ?? []).filter(skill => !own.has(skill.slug))
        setSkills(list)
        setBrainSkills(fromBrain)
        setCoworkers(brain?.coworkers ?? [])
        setBrainAvailable(brain?.available ?? false)
        setAgentSkillSummaries(agentId, [...list, ...fromBrain])
        // Resolved here rather than in an effect: the row carries the readOnly flag, so the drill-in
        // has to wait for the list anyway.
        const requested = requestedSlugRef.current
        if (requested) {
            requestedSlugRef.current = null
            consumeRequestedRef.current?.()
            const skill = list.find(s => s.slug === requested)
            if (skill) setView({ mode: 'edit', slug: skill.slug, readOnly: skill.fromConnector })
            else if (fromBrain.some(s => s.slug === requested)) openBrainSkill(requested)
            else toast.error(t('notFound'), { description: requested })
        }
        setLoading(false)
    }, [agentId, t, openBrainSkill])

    useEffect(() => {
        load()
    }, [load])

    const handleUploadFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!file) return
        setImportError(null)
        setImportNotice(null)
        if (file.size > MAX_SKILL_FILE_BYTES) {
            setImportError(t('fileTooLarge'))
            return
        }
        setImporting(true)
        const result = await importSkillAction(agentId, await file.text())
        setImporting(false)
        if (result.success) load()
        else setImportError(errorText(result, t('importFailed')))
    }, [agentId, load, t, errorText])

    const handleUploadFolder = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        if (folderInputRef.current) folderInputRef.current.value = ''
        if (!files.length) return
        setImportError(null)
        setImportNotice(null)
        setImporting(true)
        try {
            const folders = await readSkillFolders(files)
            const failures: string[] = []
            let imported = 0
            let skipped = 0
            for (const folder of folders) {
                const result = await importSkillAction(agentId, folder.content, folder.files)
                if (result.success) {
                    imported += 1
                    skipped += folder.skipped.length
                } else {
                    failures.push(t('folderFailure', { name: folder.name, error: errorText(result, t('folderImportFailed')) }))
                }
            }
            if (imported) setImportNotice(skipped ? t('importedSkipped', { count: imported, skipped }) : t('imported', { count: imported }))
            if (failures.length) setImportError(failures.join('\n'))
            load()
        } catch (err) {
            setImportError(err instanceof Error ? err.message : t('readFolderFailed'))
        } finally {
            setImporting(false)
        }
    }, [agentId, load, t, errorText])

    const shareToBrain = useCallback(
        async (skill: EngineSkillWithSource) => {
            setSharing(skill.slug)
            const result = await shareSkillToBrainAction(agentId, skill.slug)
            setSharing(null)
            setConfirmingShare(null)
            if (!result.ok) {
                toast.error(errorText(result))
                return
            }
            toast.success(t('sharedToBrain', { name: skill.name }))
            invalidateAllAgentSkillSummaries()
            void load()
        },
        [agentId, load, t, errorText],
    )

    const authorBadge = (skill: BrainSkill) => {
        if (!skill.author) return null
        const coworker = coworkerOfAuthor(skill.author, coworkers)
        return (
            <Badge size="xs" tone="neutral" glow={false} className="max-w-32" leading={coworker ? <AgentBuddy agentId={coworker.id} size={12} animated={false} facing="right" /> : undefined}>
                <span className="truncate">{coworker?.name ?? brainAuthorLabel(skill.author, tBrain)}</span>
            </Badge>
        )
    }

    const actionButtons = (
        <div className="flex items-center gap-1.5">
            <DropdownMenu>
                <TooltipDisabledReason reason={manageReason}>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" disabled={importing || !canManage}>
                            {importing ? <Loader2Icon className="size-3.5 me-1 animate-spin" /> : <UploadIcon className="size-3.5 me-1" />} {t('upload')}
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipDisabledReason>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => fileInputRef.current?.click()}>
                        <FileTextIcon />
                        {t('markdownFile')}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => folderInputRef.current?.click()}>
                        <FolderUpIcon />
                        {t('skillFolder')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <TooltipDisabledReason reason={manageReason}>
                <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setView({ mode: 'create' })}>
                    <PlusIcon className="size-3.5 me-1" /> {t('newSkill')}
                </Button>
            </TooltipDisabledReason>
        </div>
    )

    if (view.mode !== 'list') {
        return (
            <PanelSteps stepKey={view.mode === 'create' ? 'create' : `edit:${view.slug}`} depth={1}>
                <SkillEditor
                    agentId={agentId}
                    slug={view.mode === 'edit' ? view.slug : undefined}
                    readOnly={view.mode === 'edit' ? view.readOnly : undefined}
                    onDone={() => { setView({ mode: 'list' }); load() }}
                    onBack={() => setView({ mode: 'list' })}
                />
            </PanelSteps>
        )
    }

    if (loading) {
        return (
            <PanelSteps stepKey="list" depth={0}>
                <SkeletonPanelRows rows={5} badge />
            </PanelSteps>
        )
    }

    return (
        <PanelSteps stepKey="list" depth={0}>
            <div className="flex flex-col h-full">
                <input ref={fileInputRef} type="file" accept=".md,.markdown" className="hidden" onChange={handleUploadFile} />
                <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleUploadFolder} {...{ webkitdirectory: '' }} />
                <PanelListHeader countLabel={t('count', { count: skills.length + brainSkills.length })}>
                    {actionButtons}
                </PanelListHeader>
                {importError && <p className="px-3 py-2 text-xs text-destructive border-b border-border whitespace-pre-line">{importError}</p>}
                {importNotice && <p className="px-3 py-2 text-xs text-muted-foreground border-b border-border">{importNotice}</p>}

                {skills.length === 0 && brainSkills.length === 0 ? (
                    <EmptyState
                        icon={Layers}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        action={actionButtons}
                    />
                ) : (
                    <PanelScroller className="space-y-5">
                        {skills.length > 0 && (
                            <section className="space-y-1.5">
                                <h3 className="px-1 text-xs font-medium text-muted-foreground">{t('ownGroup', { name: agentName })}</h3>
                                <PanelList>
                                    {skills.map(skill => (
                                        <PanelRow
                                            key={skill.slug}
                                            onClick={() => setView({ mode: 'edit', slug: skill.slug, readOnly: skill.fromConnector })}
                                            title={skill.name}
                                            description={skill.description}
                                            meta={
                                                <>
                                                    {skill.files.length > 0 && (
                                                        <Badge size="xs" tone="neutral" glow={false} leading={<FileTextIcon className="size-2.5" />}>
                                                            {skill.files.length}
                                                        </Badge>
                                                    )}
                                                    {skill.fromConnector && (
                                                        <Badge size="xs" tone="neutral" glow={false} leading={<BlocksIcon className="size-2.5" />}>
                                                            {t('appBadge')}
                                                        </Badge>
                                                    )}
                                                </>
                                            }
                                            actions={
                                                brainAvailable &&
                                                !skill.fromConnector && (
                                                    <TooltipDisabledReason reason={manageReason}>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            disabled={!canManage || sharing !== null}
                                                            loading={sharing === skill.slug}
                                                            onClick={event => {
                                                                event.stopPropagation()
                                                                setConfirmingShare(skill)
                                                            }}
                                                            title={t('toBrainHint')}
                                                        >
                                                            <Share2Icon className="size-3.5" /> {t('toBrain')}
                                                        </Button>
                                                    </TooltipDisabledReason>
                                                )
                                            }
                                        />
                                    ))}
                                </PanelList>
                            </section>
                        )}
                        {brainSkills.length > 0 && (
                            <section className="space-y-1.5">
                                <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                                    <BrainIcon className="size-3.5" /> {t('brainGroup')}
                                </h3>
                                <PanelList>
                                    {brainSkills.map(skill => (
                                        <PanelRow key={skill.slug} onClick={() => openBrainSkill(skill.slug)} title={skill.name} description={skill.description} meta={authorBadge(skill)} />
                                    ))}
                                </PanelList>
                            </section>
                        )}
                    </PanelScroller>
                )}
            </div>
            <ConfirmDialog
                open={confirmingShare !== null}
                onOpenChange={open => !open && setConfirmingShare(null)}
                pending={sharing !== null}
                title={tBrain('skills.shareConfirmTitle', { name: confirmingShare?.name ?? '' })}
                description={tBrain('skills.shareConfirmDescription', { coworker: agentName })}
                confirmLabel={tBrain('skills.shareConfirm')}
                confirmVariant="default"
                onConfirm={() => {
                    if (confirmingShare) void shareToBrain(confirmingShare)
                }}
            />
        </PanelSteps>
    )
}
