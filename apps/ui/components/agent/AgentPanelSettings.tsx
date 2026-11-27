'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { getAgentDetailAction, updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorShell } from '@/components/ui/panel-editor'
import { AgentAccessRow } from '@/components/agent/AgentAccessRow'
import { CoworkerLookPicker } from '@/components/agent/CoworkerLookPicker'
import { SharedLinksSection } from '@/components/agent/share/SharedLinksSection'
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
import { FOREMAN_INSTRUCTIONS_MAX, VERBOSITY_LEVELS, agentKindPolicy } from '@rerun/contracts'
import { renameForemanAction } from '@/app/api/_actions/foreman-name.actions'
import { readForemanInstructionsAction, saveForemanInstructionsAction } from '@/app/api/_actions/foreman-instructions.actions'
import { useForemanStore } from '@/stores/foreman.store'
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

type ConfigValues = { soul: string; verbosity: EngineVerbosity; instructions: string }

// Le bouton de sauvegarde vit dans le footer sticky, hors du <form> : il le vise par son id.
const SETTINGS_FORM_ID = 'agent-settings-form'

export function AgentPanelSettings({ agent }: AgentPanelSettingsProps) {
    const boxManageReason = useBoxManageReason(agent.id)
    const t = useTranslations('agent.agentPanelSettings')
    const errorText = useErrorText()
    const verbosityOptions = useMemo(() => VERBOSITY_LEVELS.map((value: EngineVerbosity) => ({ value, label: t(`verbosity.${value}`) })), [t])
    const renameAgent = useBoardStore(s => s.renameAgent)
    const setAgentLook = useBoardStore(s => s.setAgentLook)
    const openNotifications = useNotificationsStore(s => s.openNotifications)
    const canManage = useCanManageAgent(agent.id)
    const manageReason = canManage ? undefined : boxManageReason
    const policy = agentKindPolicy(agent.kind ?? 'coworker')
    // The Chief of Staff's soul is the engine's; each member writes their own instructions to it instead.
    const isForeman = agent.kind === 'foreman'
    const [name, setName] = useState(agent.name)
    const [loading, setLoading] = useState(true)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [instructionsUnreadable, setInstructionsUnreadable] = useState(false)
    // Off on a box that predates them.
    const [ownInstructions, setOwnInstructions] = useState(isForeman)

    const form = useForm<ConfigValues>({ defaultValues: { soul: '', verbosity: 'normal', instructions: '' } })
    const {
        formState: { isSubmitting, dirtyFields },
    } = form
    // A member who cannot manage it saves their own instructions and nothing else.
    const canSave = canManage || (ownInstructions && !instructionsUnreadable && Boolean(dirtyFields.instructions))

    useEffect(() => {
        setName(agent.name)
    }, [agent.name])

    const commitName = useCallback(() => {
        const trimmed = name.trim()
        if (!trimmed) {
            setName(agent.name)
            return
        }
        if (trimmed === agent.name) return
        // The Chief of Staff's name is the workspace's, written on the hub: its engine keeps its own.
        if (agent.kind === 'foreman') {
            void renameForemanAction(trimmed).then(result => {
                if (result.ok) useForemanStore.getState().setName(result.name)
                else setError(errorText(result))
            })
            return
        }
        renameAgent(agent.id, trimmed)
    }, [name, agent.id, agent.name, agent.kind, renameAgent, errorText])

    useEffect(() => {
        setLoading(true)
        Promise.all([getAgentDetailAction(agent.id), isForeman ? readForemanInstructionsAction() : null])
            .then(([detail, instructions]) => {
                const instructionsRead = !isForeman || Boolean(instructions?.ok)
                setInstructionsUnreadable(!instructionsRead)
                setOwnInstructions(isForeman && !(instructions?.ok && !instructions.supported))
                if (!detail || !instructionsRead) setError(t('unreachable'))
                form.reset({
                    soul: detail?.soul ?? '',
                    verbosity: detail?.config.verbosity ?? 'normal',
                    instructions: instructions?.ok ? (instructions.instructions ?? '') : '',
                })
            })
            .catch(() => setError(t('unreachable')))
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id])

    const handleSave = form.handleSubmit(async ({ soul, verbosity, instructions }) => {
        setError(null)
        // Only once they were edited: a field left as loaded must never overwrite what the chat saved since.
        if (ownInstructions && instructions !== form.formState.defaultValues?.instructions) {
            const savedInstructions = await saveForemanInstructionsAction(instructions)
            if (!savedInstructions.ok) {
                setError(errorText(savedInstructions, t('saveFailed')))
                return
            }
            form.resetField('instructions', { defaultValue: savedInstructions.instructions ?? '' })
        }
        if (canManage) {
            // Note: provider/model are intentionally omitted here — they are owned by the
            // in-chat ModelSelector. Including them would overwrite the user's selection.
            const result = await updateAgentConfigAction(agent.id, policy.soulEditable ? { soul, verbosity } : { verbosity })
            if (!result.success) {
                setError(errorText(result, t('saveFailed')))
                return
            }
        }
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
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

                {policy.look === 'buddy' && (
                    <Field label={t('appearance')}>
                        <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                            <CoworkerLookPicker agentId={agent.id} look={agent.look ?? null} onChange={look => setAgentLook(agent.id, look)} disabled={!canManage} />
                        </TooltipDisabledReason>
                    </Field>
                )}

                {/* Un agent éteint ne répond plus : son détail engine est inatteignable par construction,
                    pas par panne. Seuls le renommage et la suppression restent utiles ici. */}
                {agent.disabledAt ? <p className="text-xs text-muted-foreground">{t('inactive')}</p> : error && <p className="text-xs text-destructive">{error}</p>}

                <Separator />

                <Form {...form}>
                    <form id={SETTINGS_FORM_ID} onSubmit={handleSave} className="flex flex-col gap-4">
                        {policy.soulEditable && (
                            <FormField
                                control={form.control}
                                name="soul"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <TooltipDisabledReason reason={manageReason} className="flex w-full flex-col">
                                            <FormControl>
                                                <MarkdownTextarea label={t('soul.label')} dialogTitle={t('soul.dialogTitle')} className="text-xs min-h-32 font-mono" placeholder={t('soul.placeholder')} {...field} disabled={!canManage} />
                                            </FormControl>
                                        </TooltipDisabledReason>
                                    </FormItem>
                                )}
                            />
                        )}

                        {ownInstructions && (
                            <FormField
                                control={form.control}
                                name="instructions"
                                render={({ field }) => (
                                    <FormItem className="space-y-1">
                                        <FormControl>
                                            <MarkdownTextarea label={t('instructions.label')} optional helperText={t('instructions.helper', { max: FOREMAN_INSTRUCTIONS_MAX })} dialogTitle={t('instructions.dialogTitle')} className="text-xs min-h-32" placeholder={t('instructions.placeholder')} maxLength={FOREMAN_INSTRUCTIONS_MAX} {...field} disabled={instructionsUnreadable} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        )}

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

                {policy.shareable && <SharedLinksSection agentId={agent.id} />}

                {policy.reach === 'box' && <AgentAccessRow agent={agent} />}

                <Field label={t('notifications.label')}>
                    <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => openNotifications(agent.id)}>
                        <BellIcon className="size-3.5" />
                        {t('notifications.choose')}
                    </Button>
                </Field>
            </PanelEditorBody>
            <PanelEditorFooter>
                {policy.deletable && (
                    <TooltipDisabledReason reason={manageReason}>
                        <DeleteAgentDialog agentId={agent.id} agentName={agent.name}>
                            <PanelDeleteButton label={t('delete')} confirm={false} disabled={!canManage} />
                        </DeleteAgentDialog>
                    </TooltipDisabledReason>
                )}
                <TooltipDisabledReason reason={ownInstructions ? undefined : manageReason} className="flex-1">
                    <Button type="submit" form={SETTINGS_FORM_ID} size="sm" className="flex-1" loading={isSubmitting} disabled={!canSave && !saved}>
                        {saved ? (
                            <>
                                <CheckIcon className="size-3.5 me-1.5 text-emerald-500" /> {t('saved')}
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
