'use client'

import { SCRIPT_DEFAULT_FOLDER, SCRIPT_TIMEOUT_CHOICES_SEC, SCRIPT_TIMEOUT_EXIT_CODE, type ScheduleScript } from '@rerun/contracts'
import { formatDuration, shortRelativeTime } from '@rerun/i18n/format'
import { ScrollFade } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { getScriptRunOutputAction, listScriptRunsAction } from '@/app/api/_actions/agent.actions'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import { useMentionComputers } from '@/components/computers/useMentionComputers'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import type { EngineRun } from '@/lib/engine/types'
import { CalendarClockIcon, ChevronRightIcon, CircleCheckIcon, TerminalIcon, TimerIcon, XCircleIcon } from '@/lib/icons'
import type { TaskOutcome } from '@/lib/schedules/outcomes'
import { cn } from '@/lib/utils'

// A routine that runs a command as it is, with no model: its fields, how its last run ended and the
// history of its runs. Each run keeps its exit code and the end of what it printed.

export const WORKSPACE_MACHINE = 'workspace'
const COMMAND_PLACEHOLDER = 'python3 scripts/sync_prices.py'
const CARD_TAIL_LINES = 3
const HISTORY_POLL_MS = 30_000
const RUNNING_POLL_MS = 3_000

export type ScriptDraft = ScheduleScript

export const newScriptDraft = (): ScriptDraft => ({ runsOn: null, folder: SCRIPT_DEFAULT_FOLDER, timeoutSec: 300, notify: 'failures' })

type RunEnd = { exitCode: number | null; status: EngineRun['status'] }

// A run someone stopped did not do its job: it never reads as a success.
const failed = (run: RunEnd) => run.status === 'error' || run.status === 'cancelled' || (run.exitCode !== null && run.exitCode !== 0)
const timedOut = (run: RunEnd) => run.exitCode === SCRIPT_TIMEOUT_EXIT_CODE

export function RunStatusIcon({ run }: { run: RunEnd }) {
    if (timedOut(run)) return <TimerIcon className="size-3.5 shrink-0 text-orange-500" />
    if (failed(run)) return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
    return <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-500" />
}

export function ScriptGlyph() {
    return (
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <TerminalIcon className="size-3.5" />
        </span>
    )
}

// The discreet link under the instruction or the command that turns one into the other.
export function ModeLink({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <Button variant="link" size="sm" className="-mt-1.5 h-auto self-start p-0 text-xs text-muted-foreground" onClick={onClick} disabled={disabled}>
            {label}
        </Button>
    )
}

export function ScriptFields({ script, onScript, command, onCommand, disabled, onInstructionInstead }: { script: ScriptDraft; onScript: (next: ScriptDraft) => void; command: string; onCommand: (next: string) => void; disabled?: boolean; onInstructionInstead: () => void }) {
    const t = useTranslations('agent.agentPanelScheduled.script')
    const timeoutLabel = (seconds: number) => (seconds >= 3600 ? t('timeoutHours', { hours: seconds / 3600 }) : t('timeoutMinutes', { minutes: seconds / 60 }))
    const { computers } = useMentionComputers()
    const runsOn = script.runsOn ?? WORKSPACE_MACHINE
    // A computer that was unlinked since still shows under its id, so the field says where it ran.
    const unknownComputer = script.runsOn && computers && !computers.some(computer => computer.id === script.runsOn)

    const pickPlace = (value: string) => {
        const onComputer = value !== WORKSPACE_MACHINE
        // A folder of the workspace machine means nothing on a computer, and the reverse.
        const folder = onComputer === Boolean(script.runsOn) ? script.folder : onComputer ? '' : SCRIPT_DEFAULT_FOLDER
        onScript({ ...script, runsOn: onComputer ? value : null, folder })
    }

    return (
        <>
            <Field label={t('runsOn')} helperText={script.runsOn ? t('onlineOnly') : undefined}>
                <Select value={runsOn} onValueChange={pickPlace} disabled={disabled}>
                    <SelectTrigger size="sm" className="w-full text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={WORKSPACE_MACHINE}>{t('workspaceMachine')}</SelectItem>
                        {(computers ?? []).map(computer => (
                            <SelectItem key={computer.id} value={computer.id}>
                                {t('linkedComputer', { name: computer.name })}
                            </SelectItem>
                        ))}
                        {unknownComputer && <SelectItem value={script.runsOn!}>{t('unlinkedComputer')}</SelectItem>}
                    </SelectContent>
                </Select>
            </Field>
            <Textarea label={t('command')} hideRequired value={command} onChange={event => onCommand(event.target.value)} disabled={disabled} spellCheck={false} placeholder={COMMAND_PLACEHOLDER} className="min-h-20 font-mono text-xs" />
            <ModeLink label={t('instructionInstead')} onClick={onInstructionInstead} disabled={disabled} />
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[1fr_7rem]">
                <Input label={t('folder')} hideRequired value={script.folder} onChange={event => onScript({ ...script, folder: event.target.value })} disabled={disabled} placeholder={script.runsOn ? '~' : SCRIPT_DEFAULT_FOLDER} spellCheck={false} className="h-8 font-mono text-xs" />
                <Field label={t('stopAfter')}>
                    <Select value={String(script.timeoutSec)} onValueChange={value => onScript({ ...script, timeoutSec: Number(value) })} disabled={disabled}>
                        <SelectTrigger size="sm" className="w-full text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SCRIPT_TIMEOUT_CHOICES_SEC.map(seconds => (
                                <SelectItem key={seconds} value={String(seconds)}>
                                    {timeoutLabel(seconds)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>
            <Field orientation="row" label={t('notifyFailures')} helperText={t('notifyHelper')}>
                <Switch checked={script.notify === 'failures'} disabled={disabled} onCheckedChange={only => onScript({ ...script, notify: only ? 'failures' : 'always' })} />
            </Field>
        </>
    )
}

// Under a script routine's row: how its last run ended, with its code, or that it never ran.
export function ScriptOutcomeFooter({ outcome }: { outcome: TaskOutcome | undefined }) {
    const t = useTranslations('agent.agentPanelScheduled.script')
    const locale = useLocale()
    if (!outcome) return <>{t('neverRan')}</>
    const run = { exitCode: outcome.exitCode, status: outcome.status }
    const time = shortRelativeTime(outcome.finishedAt, locale)
    const duration = formatDuration(Math.max(0, Date.parse(outcome.finishedAt) - Date.parse(outcome.startedAt)), locale)
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <RunStatusIcon run={run} />
            <span className={cn('truncate', failed(run) && 'text-destructive')}>
                {!failed(run) ? t('rowSucceeded', { duration, time }) : outcome.exitCode !== null ? t('rowFailed', { code: outcome.exitCode, time }) : t('rowFailedNoCode', { time })}
            </span>
        </span>
    )
}

function OutputBlock({ output, tail }: { output: string; tail?: number }) {
    const t = useTranslations('agent.agentPanelScheduled.script')
    const lines = output.replace(/\n+$/, '').split('\n')
    const shown = tail ? lines.slice(-tail) : lines
    const cut = Boolean(tail) && lines.length > (tail ?? 0)
    return (
        <ScrollFade className="max-h-48 border-t border-border bg-muted/40" fadeSize={24}>
            <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                {output.trim() ? (
                    <>
                        {cut && <span className="text-muted-foreground/60">…{'\n'}</span>}
                        {shown.join('\n')}
                    </>
                ) : (
                    <span className="font-sans italic">{t('noOutput')}</span>
                )}
            </pre>
        </ScrollFade>
    )
}

function useRunOutput(agentId: string, run: EngineRun | null): string | null {
    const [output, setOutput] = useState<{ runId: string; text: string } | null>(null)
    const runId = run?.id ?? null
    const settled = run ? run.status !== 'running' : false
    useEffect(() => {
        if (!runId || !settled) return
        let cancelled = false
        void getScriptRunOutputAction(agentId, runId).then(text => !cancelled && setOutput({ runId, text: text ?? '' }))
        return () => {
            cancelled = true
        }
    }, [agentId, runId, settled])
    return output && output.runId === runId ? output.text : null
}

function useScriptRuns(agentId: string, slug: string): { runs: EngineRun[] | null } {
    const [runs, setRuns] = useState<EngineRun[] | null>(null)
    const load = useCallback(() => {
        void listScriptRunsAction(agentId, slug).then(setRuns)
    }, [agentId, slug])
    useEffect(load, [load])
    const running = runs?.some(run => run.status === 'running') ?? false
    useVisibleInterval(load, running ? RUNNING_POLL_MS : HISTORY_POLL_MS)
    return { runs }
}

// At the top of a script routine's editor: its last run, the last lines it printed, a way to the rest.
export function ScriptLastRunCard({ agentId, slug, onShowHistory }: { agentId: string; slug: string; onShowHistory: () => void }) {
    const t = useTranslations('agent.agentPanelScheduled.script')
    const locale = useLocale()
    const { runs } = useScriptRuns(agentId, slug)
    const run = runs?.[0] ?? null
    const output = useRunOutput(agentId, run)
    if (!runs) return <Skeleton className="h-24 w-full rounded-xl" />
    if (!run) return null
    const end = { exitCode: run.exitCode ?? null, status: run.status }
    const isFailure = run.status !== 'running' && failed(end)
    const label = run.status === 'running' ? t('running') : !isFailure ? t('cardSucceeded') : end.exitCode !== null ? t('cardFailed', { code: end.exitCode }) : t('cardFailedNoCode')
    return (
        <div className={cn('shrink-0 overflow-hidden rounded-xl border', isFailure ? 'border-destructive/30' : 'border-border')}>
            <button type="button" onClick={onShowHistory} className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors hover:bg-muted/40">
                {run.status === 'running' ? <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <RunStatusIcon run={end} />}
                <span className="min-w-0 flex-1 truncate">
                    <span className={cn('font-medium', isFailure ? 'text-destructive' : 'text-foreground')}>{label}</span>
                    <span className="text-muted-foreground"> · {shortRelativeTime(run.startedAt, locale)}</span>
                </span>
                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
            </button>
            {run.status !== 'running' && (output === null ? <div className="border-t border-border bg-muted/40 px-3 py-2"><Skeleton className="h-3 w-2/3" /></div> : <OutputBlock output={output} tail={CARD_TAIL_LINES} />)}
        </div>
    )
}

function HistoryRow({ agentId, run, open, onToggle }: { agentId: string; run: EngineRun; open: boolean; onToggle: () => void }) {
    const t = useTranslations('agent.agentPanelScheduled.script')
    const locale = useLocale()
    const output = useRunOutput(agentId, open ? run : null)
    const end = { exitCode: run.exitCode ?? null, status: run.status }
    const duration = run.finishedAt ? formatDuration(Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)), locale) : null
    return (
        <div className={cn('overflow-hidden rounded-xl', open && 'border border-border')}>
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors hover:bg-muted/40">
                {run.status === 'running' ? <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <RunStatusIcon run={end} />}
                <span className="min-w-0 flex-1 truncate text-foreground">{shortRelativeTime(run.startedAt, locale)}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{run.status === 'running' ? t('running') : run.exitCode !== null && run.exitCode !== undefined ? t('exitCode', { code: run.exitCode }) : t('noExitCode')}</span>
                <span className="w-14 shrink-0 text-end text-muted-foreground">{duration}</span>
                <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform rtl:rotate-180', open && 'rotate-90 rtl:rotate-90')} />
            </button>
            {open && (run.status === 'running' ? null : output === null ? <div className="border-t border-border bg-muted/40 px-3 py-2"><SkeletonRows rows={2} /></div> : <OutputBlock output={output} />)}
        </div>
    )
}

// Every run of a script routine, newest first; a row opens on everything it printed.
export function ScriptRunHistory({ agentId, slug, title, onBack }: { agentId: string; slug: string; title: string; onBack: () => void }) {
    const t = useTranslations('agent.agentPanelScheduled')
    const { runs } = useScriptRuns(agentId, slug)
    const [openId, setOpenId] = useState<string | null | undefined>(undefined)
    const shownOpen = openId === undefined ? (runs?.[0]?.id ?? null) : openId
    return (
        <PanelEditorShell>
            <PanelEditorHeader title={title} onBack={onBack} />
            <ScrollFade className="min-h-0 flex-1 p-2">
                {!runs ? (
                    <div className="p-1">
                        <SkeletonRows rows={5} />
                    </div>
                ) : runs.length === 0 ? (
                    <EmptyState icon={CalendarClockIcon} title={t('noExecutions')} />
                ) : (
                    runs.map(run => <HistoryRow key={run.id} agentId={agentId} run={run} open={shownOpen === run.id} onToggle={() => setOpenId(shownOpen === run.id ? null : run.id)} />)
                )}
            </ScrollFade>
        </PanelEditorShell>
    )
}
