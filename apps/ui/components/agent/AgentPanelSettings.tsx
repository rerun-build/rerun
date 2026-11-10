'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { getAgentDetailAction, updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorShell } from '@/components/ui/panel-editor'
import { AgentAccessRow } from '@/components/agent/AgentAccessRow'
import { SharedLinksSection } from '@/components/agent/share/SharedLinksSection'
import { TemplateContentLock } from '@/components/agent/TemplateContentLock'
import { useTemplateContentLock } from '@/hooks/useTemplateContentLock'
import { DeleteAgentDialog } from '@/components/dialogs/DeleteAgentDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SkeletonForm } from '@/components/ui/skeleton'
import { Segmented } from '@/components/ui/segmented'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { VERBOSITY_LEVELS } from '@rerun/contracts'
import type { IsoAgent } from '@/lib/board/types'
import type { EngineVerbosity } from '@/lib/engine/types'
import { useBoardStore } from '@/stores/board.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { BellIcon, CheckIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'

type AgentPanelSettingsProps = {
    agent: IsoAgent
}

type ConfigValues = { soul: string; verbosity: EngineVerbosity }

// Le bouton de sauvegarde vit dans le footer sticky, hors du <form> : il le vise par son id.
const SETTINGS_FORM_ID = 'agent-settings-form'

export function AgentPanelSettings({ agent }: AgentPanelSettingsProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelSettings')
    const errorText = useErrorText()
    const verbosityOptions = useMemo(() => VERBOSITY_LEVELS.map((value: EngineVerbosity) => ({ value, label: t(`verbosity.${value}`) })), [t])
    const renameAgent = useBoardStore(s => s.renameAgent)
    const openNotifications = useNotificationsStore(s => s.openNotifications)
    const soulLocked = useTemplateContentLock(agent.id)
    const canManage = useCanManageAgent(agent.id)
    const manageReason = canManage ? undefined : boxManageReason
    const [name, setName] = useState(agent.name)
    const [loading, setLoading] = useState(true)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const form = useForm<ConfigValues>({ defaultValues: { soul: '', verbosity: 'normal' } })
    const {
        formState: { isSubmitting },
    } = form

    useEffect(() => {
        setName(agent.name)
    }, [agent.name])

    const commitName = useCallback(() => {
        const trimmed = name.trim()
        if (!trimmed) {
            setName(agent.name)
            return
        }
        if (trimmed !== agent.name) renameAgent(agent.id, trimmed)
    }, [name, agent.id, agent.name, renameAgent])

    useEffect(() => {
        setLoading(true)
        getAgentDetailAction(agent.id)
            .then(detail => {
                if (!detail) {
                    setError(t('unreachable'))
                    return
                }
                const c = detail.config
                form.reset({
                    soul: detail.soul,
                    verbosity: c.verbosity,
                })
            })
            .catch(() => setError(t('unreachable')))
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id])

    const handleSave = form.handleSubmit(async ({ soul, verbosity }) => {
        setError(null)
        // Note: provider/model are intentionally omitted here — they are owned by the
        // in-chat ModelSelector. Including them would overwrite the user's selection.
        // A sealed soul is dropped server-side, so the rest of this form still saves.
        const result = await updateAgentConfigAction(agent.id, { soul, verbosity })
        if (result.success) {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        } else {
            setError(errorText(result, t('saveFailed')))
        }
    })

    if (loading) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <SkeletonForm />
            </div>
        )
    }

    return (
        <PanelEditorShell>
            <PanelEditorBody>
                <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                    <Input
                        label={t('name')}
                        hideRequired
                        disabled={!canManage}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                            if (e.key === 'Escape') {
                                setName(agent.name)
                                e.currentTarget.blur()
                            }
                        }}
                        className="h-8 text-xs"
                    />
                </TooltipDisabledReason>

                {/* Un agent éteint ne répond plus : son détail engine est inatteignable par construction,
                    pas par panne. Seuls le renommage et la suppression restent utiles ici. */}
                {agent.disabledAt ? <p className="text-xs text-muted-foreground">{t('inactive')}</p> : error && <p className="text-xs text-destructive">{error}</p>}

                <Separator />

                <Form {...form}>
                    <form id={SETTINGS_FORM_ID} onSubmit={handleSave} className="flex flex-col gap-4">
                        <FormField
                            control={form.control}
                            name="soul"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <TemplateContentLock locked={soulLocked} subject="system prompt">
                                        <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                                            <FormControl>
                                                <MarkdownTextarea label={t('soul.label')} dialogTitle={t('soul.dialogTitle')} className="text-xs min-h-32 font-mono" placeholder={t('soul.placeholder')} {...field} disabled={soulLocked || !canManage} />
                                            </FormControl>
                                        </TooltipDisabledReason>
                                    </TemplateContentLock>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="verbosity"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <Field label={t('verbosity.label')} helperText={t('verbosity.helper')}>
                                        <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                                            <FormControl>
                                                <Segmented options={verbosityOptions} value={field.value} onChange={field.onChange} className={canManage ? undefined : 'pointer-events-none opacity-60'} />
                                            </FormControl>
                                        </TooltipDisabledReason>
                                    </Field>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>

                <SharedLinksSection agentId={agent.id} />

                <AgentAccessRow agent={agent} />

                <Field label={t('notifications.label')}>
                    <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => openNotifications(agent.id)}>
                        <BellIcon className="size-3.5" />
                        {t('notifications.choose')}
                    </Button>
                </Field>
            </PanelEditorBody>
            <PanelEditorFooter>
                <TooltipDisabledReason reason={manageReason}>
                    <DeleteAgentDialog agentId={agent.id} agentName={agent.name}>
                        <PanelDeleteButton label={t('delete')} confirm={false} disabled={!canManage} />
                    </DeleteAgentDialog>
                </TooltipDisabledReason>
                <TooltipDisabledReason reason={manageReason} className="flex-1">
                    <Button type="submit" form={SETTINGS_FORM_ID} size="sm" className="flex-1" loading={isSubmitting} disabled={!canManage}>
                        {saved ? (
                            <>
                                <CheckIcon className="size-3.5 mr-1.5 text-emerald-500" /> {t('saved')}
                            </>
                        ) : (
                            t('save')
                        )}
                    </Button>
                </TooltipDisabledReason>
            </PanelEditorFooter>
        </PanelEditorShell>
    )
}
