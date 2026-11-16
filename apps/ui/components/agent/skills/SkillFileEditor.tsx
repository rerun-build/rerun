'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { deleteSkillFileAction, readSkillFileAction, writeSkillFileAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type SkillFileEditorProps = {
    agentId: string
    slug: string
    path: string
    readOnly?: boolean
    onBack: () => void
}

export function SkillFileEditor({ agentId, slug, path, readOnly: readOnlyProp, onBack }: SkillFileEditorProps) {
    const t = useTranslations('agent.skillFileEditor')
    const errorText = useErrorText()
    const tShared = useTranslations('agent.modelsShared')
    const canManage = useCanManageAgent(agentId)
    const readOnly = readOnlyProp || !canManage
    const manageReason = canManage ? undefined : tShared('boxManageReason')
    const [loading, setLoading] = useState(true)
    const [content, setContent] = useState('')
    const [truncated, setTruncated] = useState(false)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setLoading(true)
        readSkillFileAction(agentId, slug, path)
            .then(result => {
                if (result) {
                    setContent(result.content)
                    setTruncated(result.truncated)
                } else {
                    setError(t('readFailed'))
                }
            })
            .finally(() => setLoading(false))
    }, [agentId, slug, path, t])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)
        const result = await writeSkillFileAction(agentId, slug, path, content)
        setSaving(false)
        if (result.success) onBack()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, slug, path, content, onBack, t, errorText])

    const handleDelete = useCallback(async () => {
        setDeleting(true)
        setError(null)
        const result = await deleteSkillFileAction(agentId, slug, path)
        setDeleting(false)
        if (result.success) onBack()
        else setError(errorText(result, t('deleteFailed')))
    }, [agentId, slug, path, onBack, t, errorText])

    return (
        <PanelEditorShell>
            <PanelEditorHeader title={path} onBack={onBack} mono />
            <PanelEditorBody>
                {error && <p className="text-xs text-destructive">{error}</p>}
                {truncated && <p className="text-xs text-muted-foreground">{t('truncated')}</p>}
                {loading ? (
                    <SkeletonRows rows={8} />
                ) : (
                    <Textarea value={content} onChange={e => setContent(e.target.value)} disabled={readOnly || truncated} className="text-xs min-h-96 font-mono" />
                )}
            </PanelEditorBody>
            {!readOnlyProp && (
                <PanelEditorFooter>
                    <TooltipDisabledReason reason={manageReason}>
                        <PanelDeleteButton
                            label={t('delete')}
                            busy={deleting}
                            disabled={!!manageReason}
                            onClick={handleDelete}
                            confirmTitle={t('deleteTitle', { path })}
                            confirmDescription={t('deleteDescription')}
                        />
                    </TooltipDisabledReason>
                    <TooltipDisabledReason reason={manageReason} className="flex-1">
                        <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={!!manageReason || loading || truncated}>
                            {t('saveChanges')}
                        </Button>
                    </TooltipDisabledReason>
                </PanelEditorFooter>
            )}
        </PanelEditorShell>
    )
}
