'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createScheduleAction, deleteScheduleAction, getScheduleAction, listAgentRoutinesAction, listScheduleRunsAction, listTaskOutcomesAction, parseScheduleAction, supportsScriptRoutinesAction, testScheduleAction, updateScheduleAction, type WorkspaceRoutine } from '@/app/api/_actions/agent.actions'
import { adoptRunSession, RunHistoryList } from '@/components/agent/AgentRunHistory'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { RunModelField, useRunModel } from '@/components/agent/RunModelField'
import { TaskNotifyField } from '@/components/agent/TaskNotifyField'
import { TaskOutcomeFooter } from '@/components/agent/TaskOutcomeFooter'
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
import { humanCron } from '@/lib/schedules/cron'
import { outcomeKey, type TaskOutcome } from '@/lib/schedules/outcomes'
import { CalendarClockIcon, HistoryIcon, PencilIcon, PlusIcon } from '@/lib/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelListHeader } from '@/components/ui/panel-list'
import { RoutineMenu } from '@/components/routines/RoutineMenu'
import { RoutinesSkeleton } from '@/components/routines/RoutinesSkeleton'
import { useRoutines } from '@/components/routines/useRoutines'
import { PanelSteps } from '@/components/ui/panel-steps'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useBoardStore } from '@/stores/board.store'
import { RoutineList } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import type { ScheduleKind } from '@rerun/contracts'
import { ModeLink, newScriptDraft, ScriptFields, ScriptGlyph, ScriptLastRunCard, ScriptOutcomeFooter, ScriptRunHistory, type ScriptDraft } from '@/components/agent/ScriptRoutine'
import { useMentionComputers } from '@/components/computers/useMentionComputers'
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

type View = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; slug: string } | { mode: 'runs'; slug: string; script: boolean }

export function AgentPanelScheduled({ agentId, agentName, onOpenSession, focusSlug, onFocusConsumed }: AgentPanelScheduledProps) {
    const boxManageReason = useBoxManageReason(agentId)
    const t = useTranslations('agent.agentPanelScheduled')
    const [outcomes, setOutcomes] = useState<Record<string, TaskOutcome>>({})
    const [view, setView] = useState<View>({ mode: 'list' })
    const canManage = useCanManageAgent(agentId)
    const loadRoutines = useCallback(() => listAgentRoutinesAction(agentId), [agentId])
    const list = useRoutines({ load: loadRoutines, agentId, onRunStarted: (routine, sessionId, runId) => onOpenSession(sessionId, routine.name, runId) })
    const schedulesRefreshKey = useBoardStore(s => s.schedulesRefreshKey)
    const { computers } = useMentionComputers()
    const tScript = useTranslations('agent.agentPanelScheduled.script')

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

    useEffect(() => {
        let cancelled = false
        void listTaskOutcomesAction(agentId).then(next => !cancelled && setOutcomes(next))
        return () => {
            cancelled = true
        }
    }, [agentId, schedulesRefreshKey])

    const stepKey = view.mode === 'edit' || view.mode === 'runs' ? `${view.mode}:${view.slug}` : view.mode
    const stepDepth = view.mode === 'list' ? 0 : view.mode === 'runs' ? 2 : 1
    const backToList = () => setView({ mode: 'list' })
    const backToSavedList = () => {
        list.reload()
        backToList()
    }

    if (view.mode === 'create') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleEditor agentId={agentId} agentName={agentName} onDone={backToSavedList} onBack={backToList} />
            </PanelSteps>
        )
    }

    if (view.mode === 'edit') {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleEditor agentId={agentId} agentName={agentName} slug={view.slug} onDone={backToSavedList} onBack={backToList} onShowHistory={script => setView({ mode: 'runs', slug: view.slug, script })} onOpenSession={onOpenSession} />
            </PanelSteps>
        )
    }

    if (view.mode === 'runs') {
        const backToEditor = () => setView({ mode: 'edit', slug: view.slug })
        if (view.script) {
            return (
                <PanelSteps stepKey={stepKey} depth={stepDepth}>
                    <ScriptRunHistory agentId={agentId} slug={view.slug} title={list.routines?.find(s => s.slug === view.slug)?.name ?? view.slug} onBack={backToEditor} />
                </PanelSteps>
            )
        }
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <ScheduleRuns agentId={agentId} schedule={list.routines?.find(s => s.slug === view.slug)} slug={view.slug} onBack={() => setView({ mode: 'edit', slug: view.slug })} onOpenSession={onOpenSession} />
            </PanelSteps>
        )
    }

    if (!list.routines) {
        return (
            <PanelSteps stepKey={stepKey} depth={stepDepth}>
                <RoutinesSkeleton withAgent={false} className="h-full pt-[2.875rem]" />
            </PanelSteps>
        )
    }

    const openEditor = (routine: WorkspaceRoutine) => setView({ mode: 'edit', slug: routine.slug })
    const placeOf = (routine: WorkspaceRoutine) => {
        if (routine.kind !== 'script') return undefined
        if (!routine.runsOn) return tScript('workspaceMachine')
        // Unread, the list would call every computer unlinked.
        if (!computers) return undefined
        return computers.find(computer => computer.id === routine.runsOn)?.name ?? tScript('unlinkedComputer')
    }
    const routines = list.routines.map(routine => ({ ...routine, place: placeOf(routine) }))
    const newButton = (
        <TooltipDisabledReason reason={canManage ? undefined : boxManageReason}>
            <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setView({ mode: 'create' })}>
                <PlusIcon className="size-3.5 me-1" /> {t('new')}
            </Button>
        </TooltipDisabledReason>
    )

    return (
        <PanelSteps stepKey={stepKey} depth={stepDepth}>
            <div className="flex flex-col h-full">
                <PanelListHeader countLabel={t('count', { count: list.routines.length })}>
                    {newButton}
                </PanelListHeader>

                {list.routines.length === 0 ? (
                    <EmptyState
                        icon={CalendarClockIcon}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        action={newButton}
                    />
                ) : (
                    <RoutineList
                        routines={routines}
                        now={list.now}
                        onOpen={openEditor}
                        onToggle={canManage ? list.toggle : undefined}
                        isSaving={list.isSaving}
                        renamingKey={list.renamingKey}
                        onRename={list.rename}
                        onCancelRename={list.cancelRename}
                        renderMenu={routine => <RoutineMenu routine={routine} canRename={list.canRename && canManage} onRename={() => list.startRename(routine)} onEdit={() => openEditor(routine)} onRunNow={() => list.runNow(routine)} />}
                        renderLeading={routine => (routine.kind === 'script' ? <ScriptGlyph /> : <CoworkerGlyph agentId={agentId} />)}
                        renderFooter={routine =>
                            routine.kind === 'script' ? <ScriptOutcomeFooter outcome={outcomes[outcomeKey('schedule', routine.slug)]} /> : <TaskOutcomeFooter outcome={outcomes[outcomeKey('schedule', routine.slug)]} lastStartedAt={routine.lastRunAt} />
                        }
                        className="min-h-0 flex-1 pt-1"
                    />
                )}
            </div>
        </PanelSteps>
    )
}

function CoworkerGlyph({ agentId }: { agentId: string }) {
    return (
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
            <AgentBuddy agentId={agentId} size={18} animated={false} facing="right" />
        </span>
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

function ScheduleEditor({ agentId, agentName, slug, onDone, onBack, onShowHistory, onOpenSession }: { agentId: string; agentName: string; slug?: string; onDone: () => void; onBack: () => void; onShowHistory?: (script: boolean) => void; onOpenSession?: (sessionId: string, title: string, runId: string | null) => void }) {
    const boxManageReason = useBoxManageReason(agentId)
    const t = useTranslations('agent.agentPanelScheduled.editor')
    const tScript = useTranslations('agent.agentPanelScheduled.script')
    const tErrors = useTranslations('errors')
    const errorText = useErrorText()
    const isEdit = !!slug
    const { pick, setPick, availableGroups, providerFor, agentModel } = useRunModel(agentId)
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
    // The instruction and the command are kept apart, so switching back and forth loses neither.
    const [command, setCommand] = useState('')
    const [kind, setKind] = useState<ScheduleKind>('instruction')
    const [script, setScript] = useState<ScriptDraft>(newScriptDraft)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [testing, setTesting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [canRename, setCanRename] = useState(false)
    const setup = useAgentSetup(agentId)
    // Null until the engine answers. An engine older than script routines would keep the command as an
    // instruction for the model, so the link waits for it.
    const [canScript, setCanScript] = useState<boolean | null>(null)

    useEffect(() => {
        let cancelled = false
        void supportsScriptRoutinesAction(agentId).then(supported => !cancelled && setCanScript(supported))
        return () => {
            cancelled = true
        }
    }, [agentId])

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
                    setKind(s.kind)
                    if (s.kind === 'script') {
                        setCommand(s.body ?? '')
                        setScript(s.script ?? newScriptDraft())
                    } else setBody(s.body ?? '')
                }
            })
            .finally(() => setLoading(false))
    }, [agentId, slug, setPick])

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)
        const scheduling = scheduleMode === 'cron' ? { cron: cron.trim(), runAt: undefined } : { runAt: runAtLocal ? localInputToIso(runAtLocal) : '', cron: undefined }
        // A script runs no model: it carries its command and its settings instead.
        const run = kind === 'script' ? { kind, script, body: command, connectionId: null, provider: null, model: null } : { kind, script: null, body, connectionId: pick.connectionId, provider: providerFor(pick), model: pick.model }
        const result = isEdit
            ? await updateScheduleAction(agentId, slug!, { name: canRename ? name.trim() : undefined, description, timezone: timezone.trim() || undefined, enabled, ...run, ...scheduling })
            : await createScheduleAction(agentId, { name, description, timezone: timezone.trim() || undefined, ...run, ...scheduling })
        setSaving(false)
        if (result.success) useBoardStore.getState().requestSchedulesRefresh()
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, slug, isEdit, canRename, name, description, scheduleMode, cron, runAtLocal, timezone, enabled, pick, body, command, kind, script, onDone, providerFor, t, errorText])

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
                onShowHistory?.(kind === 'script')
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
    }, [agentId, slug, name, kind, onOpenSession, onShowHistory, t, errorText])

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

    const isScript = kind === 'script'
    const canSave = name.trim() && (isScript ? command.trim() : body.trim()) && (scheduleMode === 'cron' ? cron.trim() : runAtLocal)
    // Mirrors the engine, which refuses a manual run of a task still paused for the install: that run
    // would get the install prompt and ask its questions a second time.
    const waitingForSetup = setup.pending && !savedEnabled

    return (
        <PanelEditorShell>
            <PanelEditorHeader title={isEdit ? (canManage ? t('titleEdit') : t('titleReadOnly')) : t('titleNew')} onBack={onBack}>
                {isEdit && onShowHistory && (
                    <Button size="sm" variant="ghost" onClick={() => onShowHistory(isScript)}>
                        <HistoryIcon className="size-3.5 me-1" /> {t('history')}
                    </Button>
                )}
            </PanelEditorHeader>
            <PanelEditorBody>
                {error && <p className="text-xs text-destructive">{error}</p>}
                {slug && isScript && onShowHistory && <ScriptLastRunCard agentId={agentId} slug={slug} onShowHistory={() => onShowHistory(true)} />}
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

                {isScript ? (
                    <>
                        <ScriptFields script={script} onScript={setScript} command={command} onCommand={setCommand} disabled={!canManage} onInstructionInstead={() => setKind('instruction')} />
                        {isEdit && (
                            <Field orientation="row" label={t('enabled')}>
                                <Switch checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} />
                            </Field>
                        )}
                    </>
                ) : (
                    <>
                        <RunModelField id="schedule-model" value={pick} onChange={setPick} availableGroups={availableGroups} agentModel={agentModel} disabled={!canManage} helperText={t('modelHelper')} />

                        {isEdit && (
                            <Field orientation="row" label={t('enabled')}>
                                <Switch checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} />
                            </Field>
                        )}

                        {slug && <TaskNotifyField agentId={agentId} source="schedule" slug={slug} />}

                        <MarkdownTextarea label={t('prompt')} dialogTitle={t('promptDialogTitle')} helperText={t('promptHelper')} value={body} onChange={setBody} disabled={!canManage} className="text-xs min-h-32 font-mono" placeholder={t('promptPlaceholder')} />
                        <TooltipDisabledReason reason={canScript === false ? tErrors('scriptRoutineNeedsUpdate') : undefined} className="self-start">
                            <ModeLink label={tScript('runInstead')} onClick={() => setKind('script')} disabled={!canManage || canScript !== true} />
                        </TooltipDisabledReason>
                    </>
                )}

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
                        {isScript ? tScript('runNow') : t('testRun')}
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

function ScheduleRuns({ agentId, schedule, slug, onBack, onOpenSession }: { agentId: string; schedule?: Pick<EngineSchedule, 'name'>; slug: string; onBack: () => void; onOpenSession: (sessionId: string, title: string, runId: string | null) => void }) {
    const t = useTranslations('agent.agentPanelScheduled')
    const loadRuns = useCallback(() => listScheduleRunsAction(agentId, slug), [agentId, slug])
    const title = schedule?.name ?? slug
    const openRun = useCallback(async (run: EngineRun) => {
        const sessionId = await adoptRunSession(agentId, run.sessionId, title)
        onOpenSession(sessionId, title, run.status === 'running' ? run.id : null)
    }, [agentId, title, onOpenSession])
    return <RunHistoryList title={title} loadRuns={loadRuns} emptyIcon={CalendarClockIcon} emptyLabel={t('noExecutions')} onBack={onBack} onSelectRun={openRun} />
}
