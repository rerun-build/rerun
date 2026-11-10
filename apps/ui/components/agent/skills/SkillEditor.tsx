'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createSkillAction, deleteSkillAction, downloadSkillArchiveAction, getSkillAction, updateSkillAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkillFileEditor } from '@/components/agent/skills/SkillFileEditor'
import { SkillFilesSection } from '@/components/agent/skills/SkillFilesSection'
import { TemplateContentLock } from '@/components/agent/TemplateContentLock'
import { useTemplateContentLock } from '@/hooks/useTemplateContentLock'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { DownloadIcon } from '@/lib/icons'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type SkillEditorProps = {
    agentId: string
    slug?: string
    readOnly?: boolean
    onDone: () => void
    onBack: () => void
}

export function SkillEditor({ agentId, slug, readOnly: readOnlyProp, onDone, onBack }: SkillEditorProps) {
    const t = useTranslations('agent.skillEditor')
    const errorText = useErrorText()
    const tShared = useTranslations('agent.modelsShared')
    const isEdit = !!slug
    // Only an existing skill is sealed: writing a new one on a template's agent stays open, and an
    // empty form has nothing to hide anyway.
    const locked = useTemplateContentLock(agentId) && isEdit
    // A sealed skill is shown, never edited: the body in this form is the filler the server sent,
    // so saving it would write that filler over the real procedure.
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : tShared('boxManageReason')
    const readOnly = readOnlyProp || locked || !canManage
    const saveReason = locked ? t('locks.edit') : manageReason
    const deleteReason = locked ? t('locks.delete') : manageReason
    const [loading, setLoading] = useState(isEdit)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [body, setBody] = useState('')
    const [files, setFiles] = useState<string[]>([])
    const [openFile, setOpenFile] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const load = useCallback(async () => {
        if (!slug) return
        const skill = await getSkillAction(agentId, slug)
        if (skill) {
            setName(skill.name)
            setDescription(skill.description ?? '')
            setBody(skill.body ?? '')
            setFiles(skill.files ?? [])
        }
        setLoading(false)
    }, [agentId, slug])

    useEffect(() => {
        load()
    }, [load])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)
        const result = isEdit ? await updateSkillAction(agentId, slug!, { description, body }) : await createSkillAction(agentId, { name, description, body })
        setSaving(false)
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, slug, isEdit, name, description, body, onDone, t, errorText])

    const handleDownload = useCallback(async () => {
        if (files.length === 0) {
            const content = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`
            downloadBlob(new Blob([content], { type: 'text/markdown' }), `${slug}.md`)
            return
        }
        setDownloading(true)
        setError(null)
        const result = await downloadSkillArchiveAction(agentId, slug!)
        setDownloading(false)
        if (!result.success || !result.base64) {
            setError(errorText(result, t('downloadFailed')))
            return
        }
        const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
        downloadBlob(new Blob([bytes], { type: 'application/gzip' }), `${slug}.tar.gz`)
    }, [agentId, slug, name, description, body, files.length, t, errorText])

    const handleDelete = useCallback(async () => {
        setDeleting(true)
        const result = await deleteSkillAction(agentId, slug!)
        setDeleting(false)
        if (result.success) onDone()
        else setError(errorText(result, t('deleteFailed')))
    }, [agentId, slug, onDone, t, errorText])

    if (loading) {
        return (
            <div className="p-3">
                <SkeletonRows rows={6} />
            </div>
        )
    }

    if (openFile && slug) {
        return (
            <PanelSteps stepKey={`file:${openFile}`} depth={1}>
                <SkillFileEditor
                    agentId={agentId}
                    slug={slug}
                    path={openFile}
                    readOnly={readOnlyProp}
                    onBack={() => {
                        setOpenFile(null)
                        load()
                    }}
                />
            </PanelSteps>
        )
    }

    return (
        <PanelSteps stepKey="skill" depth={0}>
            <PanelEditorShell>
                <PanelEditorHeader title={readOnly ? t('titleView') : isEdit ? t('titleEdit') : t('titleNew')} onBack={onBack}>
                    {isEdit && !readOnlyProp && (
                        // Kept in place when sealed rather than removed: a button that disappears never
                        // says why it went.
                        <TooltipDisabledReason reason={locked ? t('locks.download') : undefined}>
                            <Button size="icon-sm" variant="ghost" loading={downloading} disabled={locked} onClick={handleDownload} title={t('download')} aria-label={t('download')}>
                                <DownloadIcon className="size-4" />
                            </Button>
                        </TooltipDisabledReason>
                    )}
                </PanelEditorHeader>
                <PanelEditorBody>
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    {readOnlyProp && <p className="text-xs text-muted-foreground">{t('connectorManaged')}</p>}
                    <Input label={t('name')} helperText={isEdit && !readOnly ? t('nameLocked') : undefined} hideRequired value={name} onChange={e => setName(e.target.value)} disabled={isEdit || readOnly} placeholder={t('namePlaceholder')} className="h-8 text-sm" />
                    <Input label={t('description')} hideRequired value={description} onChange={e => setDescription(e.target.value)} disabled={readOnly} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />
                    <TemplateContentLock locked={locked} subject="skills">
                        <MarkdownTextarea label={t('procedure')} dialogTitle={t('procedureDialogTitle')} value={body} onChange={setBody} disabled={readOnly} className="text-xs min-h-48 font-mono" placeholder={t('procedurePlaceholder')} />
                    </TemplateContentLock>
                    {isEdit && <SkillFilesSection agentId={agentId} slug={slug!} files={files} readOnly={readOnlyProp} addLockedReason={locked ? t('locks.addFile') : manageReason} deleteLockedReason={locked ? t('locks.deleteFile') : manageReason} onOpen={setOpenFile} onChanged={load} />}
                </PanelEditorBody>
                {!readOnlyProp && (
                    <PanelEditorFooter>
                        {isEdit && (
                            <TooltipDisabledReason reason={deleteReason}>
                                <PanelDeleteButton
                                    label={t('delete')}
                                    busy={deleting}
                                    disabled={!!deleteReason}
                                    onClick={handleDelete}
                                    confirmTitle={name ? t('deleteTitle', { name }) : t('deleteTitleUnnamed')}
                                    confirmDescription={t('deleteDescription')}
                                />
                            </TooltipDisabledReason>
                        )}
                        <TooltipDisabledReason reason={saveReason} className="flex-1">
                            <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={!!saveReason || !name.trim()}>
                                {isEdit ? t('saveChanges') : t('create')}
                            </Button>
                        </TooltipDisabledReason>
                    </PanelEditorFooter>
                )}
            </PanelEditorShell>
        </PanelSteps>
    )
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}
