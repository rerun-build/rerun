'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createScheduleAction, deleteScheduleAction, getScheduleAction, listScheduleRunsAction, listSchedulesAction, listTaskOutcomesAction, parseScheduleAction, testScheduleAction, updateScheduleAction } from '@/app/api/_actions/agent.actions'
import { adoptRunSession, RunHistoryList } from '@/components/agent/AgentRunHistory'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { RunModelField, useRunModel } from '@/components/agent/RunModelField'
import { TaskNotifyField } from '@/components/agent/TaskNotifyField'
import { TaskOutcomeFooter } from '@/components/agent/TaskOutcomeFooter'
import { TemplateContentLock } from '@/components/agent/TemplateContentLock'
import { useTemplateContentLock } from '@/hooks/useTemplateContentLock'
import { useAgentSetup } from '@/hooks/useAgentSetup'
import { installSessionTitle } from '@/lib/chat/install-marker'
import { TimezoneCombobox } from '@/components/agent/TimezoneCombobox'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import type { EngineRun, EngineSchedule } from '@/lib/engine/types'
import { humanCron, scheduleSummary } from '@/lib/schedules/cron'
import { outcomeKey, type TaskOutcome } from '@/lib/schedules/outcomes'
import { CalendarClockIcon, HistoryIcon, PauseIcon, PencilIcon, PlusIcon } from '@/lib/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelListHeader, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonPanelRows, SkeletonRows } from '@/components/ui/skeleton'
import { useBoardStore } from '@/stores/board.store'
import { Badge } from '@rerun/ui/primitives'
import { formatDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

type AgentPanelScheduledProps = {
    agentId: string
    agentName: string
    onOpenSession: (sessionId: string, title: string, runId: string | null) => void
    focusSlug?: string | null
    onFocusConsumed?: () => void
}

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; slug: string } | { mode: 'runs'; slug: string }

export function AgentPanelScheduled({ agentId, agentName, onOpenSession, focusSlug, onFocusConsumed }: AgentPanelScheduledProps) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelScheduled')
    const tAgent = useTranslations('agent')
    const locale = useLocale()
    const [schedules, setSchedules] = useState<EngineSchedule[]>([])
    const [outcomes, setOutcomes] = useState<Record<string, TaskOutcome>>({})
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<View>({ mode: 'list' })
    const canManage = useCanManageAgent(agentId)

    // A routine opened from elsewhere lands on its editor, on the render that carries the request.
    const requestedFocus = focusSlug ?? null
    const [openedFocus, setOpenedFocus] = useState<string | null>(null)
    if (requestedFocus !== openedFocus) {
        setOpenedFocus(requestedFocus)
        if (requestedFocus) setView({ mode: 'edit', slug: requestedFocus })
    }
    // In a ref: the callback may come inline, and in the deps it would clear the request each render.
    const consumeFocusRef = useRef(onFocusConsumed)
    useEffect(() => {
        consumeFocusRef.current = onFocusConsumed
    })
    useEffect(() => {
        if (requestedFocus) consumeFocusRef.current?.()
    }, [requestedFocus])

    const load = useCallback(async () => {
        setLoading(true)
        const [nextSchedules, nextOutcomes] = await Promise.all([listSchedulesAction(agentId), listTaskOutcomesAction(agentId)])
        setSchedules(nextSchedules)
        setOutcomes(nextOutcomes)
        setLoading(false)
    }, [agentId])

    useEffect(() => {
        load()
    }, [load])

    const stepKey = view.mode === 'edit' || view.mode === 'runs' ? `${view.mode}:${view.slug}` : view.mode
    const stepDepth = view.mode === 'list' ? 0 : view.mode === 'runs' ? 2 : 1

    if (view.mode === 'create') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleEditor agentId={agentId} agentName={agentName} onDone={() => { setView({ mode: 'list' }); load() }} onBack={() => setView({ mode: 'list' })} />
            </PanelSteps>
        )
    }

    if (view.mode === 'edit') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleEditor agentId={agentId} agentName={agentName} slug={view.slug} onDone={() => { setView({ mode: 'list' }); load() }} onBack={() => setView({ mode: 'list' })} onShowHistory={() => setView({ mode: 'runs', slug: view.slug })} onOpenSession={onOpenSession} />
            </PanelSteps>
        )
    }

    if (view.mode === 'runs') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleRuns agentId={agentId} schedule={schedules.find(s => s.slug === view.slug)} slug={view.slug} onBack={() => setView({ mode: 'edit', slug: view.slug })} onOpenSession={onOpenSession} />
            </PanelSteps>
        )
    }

    if (loading) {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <SkeletonPanelRows rows={5} lines={3} badge />
            </PanelSteps>
        )
    }

    const newButton = (
        <TooltipDisabledReason reason={canManage ? undefined : boxManageReason}>
            <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setView({ mode: 'create' })}>
                <PlusIcon className="size-3.5 mr-1" /> {t('new')}
            </Button>
        </TooltipDisabledReason>
    )

    return (
        <PanelSteps stepKey={stepKey} depth={stepDepth}>
            <div className="flex flex-col h-full">
                <PanelListHeader count={schedules.length} noun="scheduled task">
                    {newButton}
                </PanelListHeader>

                {schedules.length === 0 ? (
                    <EmptyState
                        icon={CalendarClockIcon}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        action={newButton}
                    />
                ) : (
                    <PanelScroller>
                        <PanelList>
                            {schedules.map(s => (
                                <PanelRow
                                    key={s.slug}
                                    onClick={() => setView({ mode: 'edit', slug: s.slug })}
                                    title={s.name}
                                    description={scheduleSummary(s, tAgent, locale)}
                                    footer={<TaskOutcomeFooter outcome={outcomes[outcomeKey('schedule', s.slug)]} lastStartedAt={s.lastRunAt} />}
                                    meta={
                                        !s.enabled && (
                                            <Badge size="xs" tone="neutral" glow={false} leading={<PauseIcon className="size-3" />}>
                                                {t('paused')}
                                            </Badge>
                                        )
                                    }
                                />
                            ))}
                        </PanelList>
                    </PanelScroller>
                )}
            </div>
        </PanelSteps>
    )
}

// datetime-local <-> ISO helpers (the engine stores runAt as an ISO instant).
function isoToLocalInput(iso?: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const tzOffset = d.getTimezoneOffset() * 60000
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16)
}

function localInputToIso(local: string): string {
    return new Date(local).toISOString()
}

type ScheduleSelection = { mode: 'cron' | 'runAt'; cron?: string; runAtLocal?: string; timezone?: string }

function SchedulePicker({ mode, cron, runAtLocal, disabled, onChange }: { mode: 'cron' | 'runAt'; cron: string; runAtLocal: string; timezone: string; disabled?: boolean; onChange: (next: ScheduleSelection) => void }) {
    const t = useTranslations('agent.agentPanelScheduled.picker')
    const locale = useLocale()
    const [open, setOpen] = useState(false)
    const [input, setInput] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const errorText = useErrorText()

    const summary = mode === 'cron' ? (cron.trim() ? (humanCron(cron, locale) ?? cron) : '') : runAtLocal ? formatDate(localInputToIso(runAtLocal), locale) : ''

    const handleGenerate = useCallback(async () => {
        if (!input.trim()) return
        setBusy(true)
        setError(null)
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const result = await parseScheduleAction(input, { nowIso: new Date().toISOString(), timezone })
        setBusy(false)
        if (!result.success) {
            setError(errorText(result))
            return
        }
        const data = result.data
        onChange(data.mode === 'cron' ? { mode: 'cron', cron: data.cron, timezone: data.timezone } : { mode: 'runAt', runAtLocal: isoToLocalInput(data.runAt), timezone: data.timezone })
        setInput('')
        setOpen(false)
    }, [input, onChange, errorText])

    return (
        <Field label={t('when')}>
            <div className="flex items-center gap-1.5">
                <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                    <span className={summary ? '' : 'text-muted-foreground'}>{summary || t('notSet')}</span>
                </div>
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button size="icon-sm" variant="outline" disabled={disabled}>
                            <PencilIcon className="size-3.5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-2 p-3">
                        <Input
                            label={t('describe')}
                            hideRequired
                            autoFocus
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleGenerate()
                                }
                            }}
                            placeholder={t('describePlaceholder')}
                            className="h-8 text-sm"
                        />
                        {error && <p className="text-[10px] text-destructive">{error}</p>}
                        <div className="flex justify-end">
                            <Button size="sm" loading={busy} disabled={!input.trim()} onClick={handleGenerate}>
                                {t('update')}
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        </Field>
    )
}

function ScheduleEditor({ agentId, agentName, slug, onDone, onBack, onShowHistory, onOpenSession }: { agentId: string; agentName: string; slug?: string; onDone: () => void; onBack: () => void; onShowHistory?: () => void; onOpenSession?: (sessionId: string, title: string, runId: string | null) => void }) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelScheduled.editor')
    const errorText = useErrorText()
    const isEdit = !!slug
    const { pick, setPick, availableGroups, providerFor, agentModel } = useRunModel(agentId)
    // Only the prompt is sealed: pausing a task or moving its hour stays available.
    const promptLocked = useTemplateContentLock(agentId) && isEdit
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason
    const [loading, setLoading] = useState(isEdit)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [scheduleMode, setScheduleMode] = useState<'cron' | 'runAt'>('cron')
    const [cron, setCron] = useState('0 8 * * *')
    const [runAtLocal, setRunAtLocal] = useState('')
    const [timezone, setTimezone] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [savedEnabled, setSavedEnabled] = useState(true)
    const [body, setBody] = useState('')
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [testing, setTesting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [canRename, setCanRename] = useState(false)
    const setup = useAgentSetup(agentId)

    useEffect(() => {
        if (!slug) return
        setLoading(true)
        getScheduleAction(agentId, slug)
            .then(found => {
                if (found) {
                    const s = found.schedule
                    setCanRename(found.canRename)
                    setName(s.name)
                    setDescription(s.description ?? '')
                    if (s.runAt) {
                        setScheduleMode('runAt')
                        setRunAtLocal(isoToLocalInput(s.runAt))
                    } else {
                        setScheduleMode('cron')
                        setCron(s.cron ?? '')
                    }
                    setTimezone(s.timezone ?? '')
                    setEnabled(s.enabled ?? true)
                    setSavedEnabled(s.enabled ?? true)
                    setPick({ connectionId: s.connectionId ?? null, model: s.model })
                    setBody(s.body ?? '')
                }
            })
            .finally(() => setLoading(false))
    }, [agentId, slug, setPick])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)
        const scheduling = scheduleMode === 'cron' ? { cron: cron.trim(), runAt: undefined } : { runAt: runAtLocal ? localInputToIso(runAtLocal) : '', cron: undefined }
        const provider = providerFor(pick)
        const result = isEdit
            ? await updateScheduleAction(agentId, slug!, { name: canRename ? name.trim() : undefined, description, body, timezone: timezone.trim() || undefined, enabled, connectionId: pick.connectionId, provider, model: pick.model, ...scheduling })
            : await createScheduleAction(agentId, { name, description, body, timezone: timezone.trim() || undefined, connectionId: pick.connectionId, provider, model: pick.model, ...scheduling })
        setSaving(false)
        if (result.success) useBoardStore.getState().requestSchedulesRefresh()
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, slug, isEdit, canRename, name, description, scheduleMode, cron, runAtLocal, timezone, enabled, pick, body, onDone, providerFor, t, errorText])

    const handleTest = useCallback(async () => {
        if (!slug) return
        setTesting(true)
        setError(null)
        try {
            const result = await testScheduleAction(agentId, slug)
            if (!result.success || !result.runId) {
                setError(errorText(result, t('runFailed')))
                return
            }
            if (!result.sessionId) {
                onShowHistory?.()
                return
            }
            const title = name.trim() || slug
            const sessionId = await adoptRunSession(agentId, result.sessionId, title)
            onOpenSession?.(sessionId, title, result.runId)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('runFailed'))
        } finally {
            setTesting(false)
        }
    }, [agentId, slug, name, onOpenSession, onShowHistory, t, errorText])

    const handleDelete = useCallback(async () => {
        if (!slug) return
        setDeleting(true)
        const result = await deleteScheduleAction(agentId, slug)
        setDeleting(false)
        if (result.success) useBoardStore.getState().requestSchedulesRefresh()
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

    const canSave = name.trim() && body.trim() && (scheduleMode === 'cron' ? cron.trim() : runAtLocal)
    // Mirrors the engine, which refuses a manual run of a task still paused for the install: that run
    // would get the install prompt and ask its questions a second time.
    const waitingForSetup = setup.pending && !savedEnabled

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
                <Input label={t('name')} helperText={isEdit && !canRename ? t('nameLockedHelper') : undefined} hideRequired value={name} onChange={e => setName(e.target.value)} disabled={!canManage || (isEdit && !canRename)} maxLength={120} placeholder={t('namePlaceholder')} className="h-8 text-sm" />
                <Input label={t('description')} hideRequired value={description} onChange={e => setDescription(e.target.value)} disabled={!canManage} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />

                <SchedulePicker
                    mode={scheduleMode}
                    cron={cron}
                    runAtLocal={runAtLocal}
                    timezone={timezone}
                    disabled={!canManage}
                    onChange={next => {
                        setScheduleMode(next.mode)
                        if (next.mode === 'cron' && next.cron !== undefined) setCron(next.cron)
                        if (next.mode === 'runAt' && next.runAtLocal !== undefined) setRunAtLocal(next.runAtLocal)
                        if (next.timezone) setTimezone(next.timezone)
                    }}
                />

                <Field label={t('timezone')}>
                    <TimezoneCombobox value={timezone} onChange={setTimezone} placeholder="Europe/Paris" disabled={!canManage} />
                </Field>

                <RunModelField id="schedule-model" value={pick} onChange={setPick} availableGroups={availableGroups} agentModel={agentModel} disabled={!canManage} helperText={t('modelHelper')} />

                {isEdit && (
                    <Field orientation="row" label={t('enabled')}>
                        <Switch checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} />
                    </Field>
                )}

                {slug && <TaskNotifyField agentId={agentId} source="schedule" slug={slug} />}

                <TemplateContentLock locked={promptLocked} subject="task prompts">
                    <MarkdownTextarea label={t('prompt')} dialogTitle={t('promptDialogTitle')} helperText={t('promptHelper')} value={body} onChange={setBody} disabled={promptLocked || !canManage} className="text-xs min-h-32 font-mono" placeholder={t('promptPlaceholder')} />
                </TemplateContentLock>

                {isEdit && waitingForSetup && (
                    <p className="text-xs text-muted-foreground">
                        {setup.sessionId
                            ? t.rich('setupPendingContinue', {
                                  link: chunks => (
                                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setup.sessionId && onOpenSession?.(setup.sessionId, installSessionTitle(agentName), null)}>
                                          {chunks}
                                      </Button>
                                  ),
                              })
                            : t('setupPendingStart')}
                    </p>
                )}
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
                {isEdit && (
                    <Button size="sm" variant="outline" className="flex-1" loading={testing} onClick={handleTest} disabled={saving || waitingForSetup}>
                        {t('testRun')}
                    </Button>
                )}
                <TooltipDisabledReason reason={manageReason} className="flex-1">
                    <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={testing || !canSave || !canManage}>
                        {isEdit ? t('saveChanges') : t('create')}
                    </Button>
                </TooltipDisabledReason>
            </PanelEditorFooter>
        </PanelEditorShell>
    )
}

// --- Run history (per schedule) ---

function ScheduleRuns({ agentId, schedule, slug, onBack, onOpenSession }: { agentId: string; schedule?: EngineSchedule; slug: string; onBack: () => void; onOpenSession: (sessionId: string, title: string, runId: string | null) => void }) {
    const t = useTranslations('agent.agentPanelScheduled')
    const loadRuns = useCallback(() => listScheduleRunsAction(agentId, slug), [agentId, slug])
    const title = schedule?.name ?? slug
    const openRun = useCallback(async (run: EngineRun) => {
        const sessionId = await adoptRunSession(agentId, run.sessionId, title)
        onOpenSession(sessionId, title, run.status === 'running' ? run.id : null)
    }, [agentId, title, onOpenSession])
    return <RunHistoryList title={title} loadRuns={loadRuns} emptyIcon={CalendarClockIcon} emptyLabel={t('noExecutions')} onBack={onBack} onSelectRun={openRun} />
}
