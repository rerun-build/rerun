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
import { Switch } from '@/components/ui/switch'
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

type ThinkingChoice = 'none' | 'low' | 'medium' | 'high' | 'xhigh'
type ConfigValues = { soul: string; verbosity: EngineVerbosity; thinking: ThinkingChoice; skim: boolean }

const THINKING_CHOICES: ThinkingChoice[] = ['none', 'low', 'medium', 'high', 'xhigh']
const THINKING_UNSUPPORTED = new Set<string>(['codex', 'opencode', 'custom'])

const SETTINGS_FORM_ID = 'agent-settings-form'

export function AgentPanelSettings({ agent }: AgentPanelSettingsProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelSettings')
    const errorText = useErrorText()
    const verbosityOptions = useMemo(() => VERBOSITY_LEVELS.map((value: EngineVerbosity) => ({ value, label: t(`verbosity.${value}`) })), [t])
    const thinkingOptions = useMemo(() => THINKING_CHOICES.map(value => ({ value, label: t(`thinking.${value}`) })), [t])
    const [provider, setProvider] = useState<string | null>(null)
    const thinkingUnsupported = provider !== null && THINKING_UNSUPPORTED.has(provider)
    const renameAgent = useBoardStore(s => s.renameAgent)
    const openNotifications = useNotificationsStore(s => s.openNotifications)
    const soulLocked = useTemplateContentLock(agent.id)
    const canManage = useCanManageAgent(agent.id)
    const manageReason = canManage ? undefined : boxManageReason
    const [name, setName] = useState(agent.name)
    const [loading, setLoading] = useState(true)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const form = useForm<ConfigValues>({ defaultValues: { soul: '', verbosity: 'normal', thinking: 'none', skim: false } })
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
                    thinking: c.thinkingLevel ?? 'none',
                    skim: c.pages?.skim === true,
                })
                setProvider(c.provider)
            })
            .catch(() => setError(t('unreachable')))
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id])

    const handleSave = form.handleSubmit(async ({ soul, verbosity, thinking, skim }) => {
        setError(null)
        const result = await updateAgentConfigAction(agent.id, {
            soul,
            verbosity,
            thinkingLevel: thinking === 'none' ? null : thinking,
            ...(form.formState.dirtyFields.skim ? { pages: { skim } } : {}),
        })
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

                        <FormField
                            control={form.control}
                            name="thinking"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <Field label={t('thinking.label')} helperText={thinkingUnsupported ? t('thinking.unsupported') : t('thinking.helper')}>
                                        <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                                            <FormControl>
                                                <div data-testid="thinking-level" aria-disabled={thinkingUnsupported || !canManage} inert={thinkingUnsupported || !canManage}>
                                                    <Segmented options={thinkingOptions} value={field.value} onChange={field.onChange} className={thinkingUnsupported || !canManage ? 'opacity-60' : undefined} />
                                                </div>
                                            </FormControl>
                                        </TooltipDisabledReason>
                                    </Field>
                                </FormItem>
                            )}
                        />

                        <Field label={t('pages.label')} helperText={t('pages.helper')}>
                            <FormField
                                control={form.control}
                                name="skim"
                                render={({ field }) => (
                                    <FormItem className="flex items-start justify-between gap-3 space-y-0">
                                        <div className="flex flex-col gap-0.5">
                                            <span>{t('pages.skim.label')}</span>
                                            <span>{t('pages.skim.helper')}</span>
                                        </div>
                                        <FormControl>
                                            <Switch data-testid="pages-skim" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage} className="shrink-0" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col gap-0.5">
                                    <span>{t('pages.standing.label')}</span>
                                    <span>{t('pages.standing.locked')}</span>
                                </div>
                                <Switch data-testid="pages-standing" checked={false} disabled className="shrink-0" />
                            </div>
                        </Field>
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
