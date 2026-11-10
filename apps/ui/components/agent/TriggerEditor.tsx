'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createTriggerAction, deleteTriggerAction, getTriggerAction, rotateTriggerTokenAction, updateTriggerAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { TaskNotifyField } from '@/components/agent/TaskNotifyField'
import { TemplateContentLock } from '@/components/agent/TemplateContentLock'
import { useTemplateContentLock } from '@/hooks/useTemplateContentLock'
import { RunModelField, useRunModel } from '@/components/agent/RunModelField'
import { TriggerUrlField } from '@/components/agent/TriggerUrlField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import type { EngineTrigger, EngineTriggerMethod } from '@/lib/engine/types'
import { HistoryIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

const ALL_METHODS: EngineTriggerMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const DEFAULT_METHODS: EngineTriggerMethod[] = ['POST']

type TriggerEditorProps = {
    agentId: string
    slug?: string
    onDone: () => void
    onBack: () => void
    onShowHistory?: () => void
}

export function TriggerEditor({ agentId, slug, onDone, onBack, onShowHistory }: TriggerEditorProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.triggerEditor')
    const errorText = useErrorText()
    const isEdit = !!slug
    const { pick, setPick, availableGroups, providerFor, agentModel } = useRunModel(agentId)
    // Only the prompt is sealed: the URL, the methods and the on/off switch stay available.
    const promptLocked = useTemplateContentLock(agentId) && isEdit
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason
    const [loading, setLoading] = useState(isEdit)
    const [trigger, setTrigger] = useState<EngineTrigger | null>(null)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [methods, setMethods] = useState<EngineTriggerMethod[]>(DEFAULT_METHODS)
    const [enabled, setEnabled] = useState(true)
    const [body, setBody] = useState('')
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [rotating, setRotating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!slug) return
        setLoading(true)
        getTriggerAction(agentId, slug)
            .then(loaded => {
                if (!loaded) return
                setTrigger(loaded)
                setName(loaded.name)
                setDescription(loaded.description ?? '')
                setMethods(loaded.methods.length ? loaded.methods : DEFAULT_METHODS)
                setEnabled(loaded.enabled ?? true)
                setPick({ connectionId: loaded.connectionId ?? null, model: loaded.model })
                setBody(loaded.body ?? '')
            })
            .finally(() => setLoading(false))
    }, [agentId, slug, setPick])

    const toggleMethod = useCallback((method: EngineTriggerMethod, checked: boolean) => {
        setMethods(current => {
            const next = checked ? [...current, method] : current.filter(m => m !== method)
            return next.length ? ALL_METHODS.filter(m => next.includes(m)) : current
        })
    }, [])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)
        const provider = providerFor(pick)
        const result = isEdit
            ? await updateTriggerAction(agentId, slug!, { description, body, methods, enabled, connectionId: pick.connectionId, provider, model: pick.model })
            : await createTriggerAction(agentId, { name, description, body, methods, connectionId: pick.connectionId, provider, model: pick.model })
        setSaving(false)
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, slug, isEdit, name, description, methods, enabled, pick, body, onDone, providerFor, t, errorText])

    const handleRotate = useCallback(async () => {
        if (!slug) return
        setRotating(true)
        setError(null)
        const result = await rotateTriggerTokenAction(agentId, slug)
        setRotating(false)
        if (result.success && result.trigger) setTrigger(result.trigger)
        else setError(errorText(result, t('rotateFailed')))
    }, [agentId, slug, t, errorText])

    const handleDelete = useCallback(async () => {
        if (!slug) return
        setDeleting(true)
        const result = await deleteTriggerAction(agentId, slug)
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

    const canSave = name.trim() && body.trim() && methods.length > 0

    return (
        <PanelEditorShell>
            <PanelEditorHeader title={isEdit ? (canManage ? t('titleEdit') : t('titleReadOnly')) : t('titleNew')} onBack={onBack}>
                {isEdit && onShowHistory && (
                    <Button size="sm" variant="ghost" onClick={onShowHistory}>
                        <HistoryIcon className="size-3.5 mr-1" /> {t('history')}
                    </Button>
                )}
            </PanelEditorHeader>
            <PanelEditorBody>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Input label={t('name')} helperText={isEdit ? t('nameLockedHelper') : t('nameHelper')} hideRequired value={name} onChange={e => setName(e.target.value)} disabled={isEdit} placeholder={t('namePlaceholder')} className="h-8 text-sm" />
                <Input label={t('description')} hideRequired value={description} onChange={e => setDescription(e.target.value)} disabled={!canManage} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />

                {isEdit && trigger && <TriggerUrlField agentId={agentId} slug={trigger.slug} token={trigger.token} rotating={rotating} onRotate={handleRotate} rotateDisabledReason={manageReason} />}

                <Field label={t('methods')} helperText={methods.includes('GET') ? t('methodsGetHelper') : t('methodsHelper')}>
                    <div className="flex flex-wrap gap-3">
                        {ALL_METHODS.map(method => (
                            <label key={method} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                <Checkbox size="sm" checked={methods.includes(method)} disabled={!canManage} onCheckedChange={checked => toggleMethod(method, checked === true)} />
                                {method}
                            </label>
                        ))}
                    </div>
                </Field>

                <RunModelField id="trigger-model" value={pick} onChange={setPick} availableGroups={availableGroups} agentModel={agentModel} disabled={!canManage} helperText={t('modelHelper')} />

                {isEdit && (
                    <Field orientation="row" label={t('enabled')}>
                        <Switch checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} />
                    </Field>
                )}

                {slug && <TaskNotifyField agentId={agentId} source="trigger" slug={slug} />}

                <TemplateContentLock locked={promptLocked} subject="trigger prompts">
                    <MarkdownTextarea
                        label={t('prompt')}
                        dialogTitle={t('promptDialogTitle')}
                        helperText={t('promptHelper')}
                        value={body}
                        onChange={setBody}
                        disabled={promptLocked || !canManage}
                        className="text-xs min-h-32 font-mono"
                        placeholder={t('promptPlaceholder')}
                    />
                </TemplateContentLock>

            </PanelEditorBody>
            <PanelEditorFooter>
                {isEdit && (
                    <TooltipDisabledReason reason={manageReason}>
                        <PanelDeleteButton
                            label={t('delete')}
                            busy={deleting}
                            disabled={!canManage}
                            onClick={handleDelete}
                            confirmTitle={name ? t('deleteConfirm', { name }) : t('deleteConfirmUnnamed')}
                            confirmDescription={t('deleteDescription')}
                        />
                    </TooltipDisabledReason>
                )}
                <TooltipDisabledReason reason={manageReason} className="flex-1">
                    <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={!canSave || !canManage}>
                        {isEdit ? t('saveChanges') : t('create')}
                    </Button>
                </TooltipDisabledReason>
            </PanelEditorFooter>
        </PanelEditorShell>
    )
}
