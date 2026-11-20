'use client'

import { useState } from 'react'

import { type AppSelection, closestSuggestion, NO_APP_SELECTION, selectedApps, toggleApp } from './apps'
import { declaredAgentName } from './declared-agent-name'
import type { FieldFooterProps } from './FieldFooter'
import { fallbackAgentName } from './fallback-agent-name'
import { AGENT_NAME_MAX, type JobReading } from './reading'
import { buildKickoff, DESCRIBED, type ScheduleChoice } from './schedule'
import type { AgentSuggestion } from './types'
import { type JobReader, useJobReading } from './useJobReading'
import { useTimeZone } from './useTimeZone'

// How long Create waits for the reading of what was just typed before going without it.
const SETTLE_MS = 2500

// A name the description did not choose: a suggestion's, kept while the description is edited, or
// one typed in the pill. Neither follows the description any more.
type PinnedName = { name: string; from: 'pick' | 'rename' }

export type NewAgentDraft = { text: string; pinned: PinnedName | null; picked: string | null; editing: boolean; scheduleOpen: boolean; apps: AppSelection; schedule: ScheduleChoice }

export const EMPTY_DRAFT: NewAgentDraft = { text: '', pinned: null, picked: null, editing: false, scheduleOpen: false, apps: NO_APP_SELECTION, schedule: DESCRIBED }

// `scheduled` says a timing goes with the job, read in the description or chosen in the planner.
export type NewAgentRequest = { name: string; serviceSlugs: string[]; kickoff: string; suggestionId: string | null; scheduled: boolean }

function settled(reading: Promise<JobReading>, fallback: JobReading): Promise<JobReading> {
    return Promise.race([reading, new Promise<JobReading>(resolve => setTimeout(() => resolve(fallback), SETTLE_MS))])
}

// The slice of the pool on offer. Without a count the whole pool is offered and there is nothing to
// reload; with one, each reload slides the window on and wraps round the end, so the ideas keep
// coming and eventually come back.
export function suggestionsOnOffer(suggestions: AgentSuggestion[], offset: number, shown?: number): AgentSuggestion[] {
    if (shown === undefined || suggestions.length <= shown) return suggestions
    return Array.from({ length: shown }, (_, index) => suggestions[(offset + index) % suggestions.length])
}

// The agent being described, wherever its composer is drawn: the text, what Rerun reads in it, and
// what the user changed by hand over that reading. `seed` is a draft, and the reading already known
// for it, to open on.
//
// Nothing is created here: `onCreate` receives the agent as described.
export function useNewAgentDraft({ suggestions, shown, read, onCreate, seed }: { suggestions: AgentSuggestion[]; shown?: number; read: JobReader; onCreate: (agent: NewAgentRequest) => void; seed?: { draft: NewAgentDraft; reading?: JobReading } }) {
    const [draft, setDraft] = useState(seed?.draft ?? EMPTY_DRAFT)
    const [creating, setCreating] = useState(false)
    const [previewed, setPreviewed] = useState<AgentSuggestion | null>(null)
    const [offset, setOffset] = useState(0)
    const timeZone = useTimeZone()
    const { reading, pending, settle } = useJobReading(draft.text, read, seed?.reading ? { text: seed.draft.text, reading: seed.reading } : undefined)

    const offered = suggestionsOnOffer(suggestions, offset, shown)
    const pickedSuggestion = suggestions.find(suggestion => suggestion.id === draft.picked) ?? null
    const declaredName = declaredAgentName(draft.text)
    const name = draft.pinned?.name ?? declaredName ?? reading.name
    const described = draft.text.trim() !== ''
    const apps = selectedApps(pickedSuggestion?.apps ?? [], reading.apps, draft.apps)
    const closest = described && !draft.picked ? (closestSuggestion(apps, offered)?.id ?? null) : null

    function write(text: string) {
        // An edited suggestion is a job of one's own: it keeps the name it came with, not its place
        // among the suggestions.
        setDraft(current => ({ ...current, text, picked: current.picked && text === pickedSuggestion?.kickoff ? current.picked : null }))
    }

    function pick(chosen: AgentSuggestion) {
        setPreviewed(null)
        setDraft({ ...EMPTY_DRAFT, text: chosen.kickoff, pinned: { name: chosen.name.slice(0, AGENT_NAME_MAX), from: 'pick' }, picked: chosen.id })
    }

    function rename(next: string) {
        const name = next.slice(0, AGENT_NAME_MAX).trimEnd()
        setDraft(current => ({ ...current, editing: false, pinned: name ? { name, from: 'rename' } : null }))
    }

    async function create() {
        if (!described || creating) return
        setCreating(true)
        const latest = pending ? await settled(settle(), reading) : reading
        onCreate({
            name: draft.pinned?.name ?? declaredName ?? latest.name ?? fallbackAgentName(draft.text),
            serviceSlugs: selectedApps(pickedSuggestion?.apps ?? [], latest.apps, draft.apps),
            kickoff: buildKickoff(draft.text, draft.schedule, timeZone),
            suggestionId: draft.picked,
            scheduled: draft.schedule.kind === 'described' ? latest.schedule !== null : draft.schedule.kind !== 'on-demand',
        })
        setCreating(false)
    }

    const footer: Omit<FieldFooterProps, 'catalog'> = {
        name,
        nameProps: {
            editing: draft.editing,
            onEdit: () => setDraft(current => ({ ...current, editing: true, scheduleOpen: false })),
            onRename: rename,
            onCancel: () => setDraft(current => ({ ...current, editing: false })),
        },
        apps,
        onToggleApp: slug => setDraft(current => ({ ...current, apps: toggleApp(current.apps, slug, apps.includes(slug)) })),
        schedule: {
            read: reading.schedule,
            choice: draft.schedule,
            onChoice: schedule => setDraft(current => ({ ...current, schedule })),
            open: draft.scheduleOpen,
            onOpenChange: scheduleOpen => setDraft(current => ({ ...current, scheduleOpen })),
        },
        canCreate: described,
        creating,
    }

    return {
        name,
        described,
        pending,
        editing: draft.editing,
        composer: {
            text: draft.text,
            onText: write,
            onSubmit: create,
            preview: previewed && previewed.id !== draft.picked ? previewed.kickoff : null,
            mark: draft.scheduleOpen && draft.schedule.kind === 'described' ? (reading.schedule?.source ?? null) : null,
            ...footer,
        },
        forYou: { suggestions: offered, picked: draft.picked, closest, onPick: pick, onPreview: setPreviewed, onReload: offered.length < suggestions.length ? () => setOffset(current => current + offered.length) : undefined },
    }
}
