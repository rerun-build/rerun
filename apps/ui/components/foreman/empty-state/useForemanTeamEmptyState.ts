'use client'

import type { TeamEmptyStateCopy } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import { teamEmptyStateOf, type TeamEmptyStateModel } from '@/lib/foreman/team-empty-state'
import { readFirstName } from '@/lib/naming/first-name'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'

// Null until the board is hydrated: an empty agent list before that would flash the "no coworkers
// yet" screen at someone who has a team.
export function useForemanTeamEmptyState(): { model: TeamEmptyStateModel; now: number } | null {
    const hydrated = useBoardStore(state => state.hydrated)
    const agents = useBoardStore(state => state.agents)
    const schedules = useBoardStore(state => state.agentSchedules)
    const { session } = useSession()
    const firstName = readFirstName(session?.user.user_metadata)
    const [now] = useState(() => Date.now())
    const t = useTranslations('foreman.teamEmptyState')
    const copy = useMemo<TeamEmptyStateCopy>(
        () => ({
            greeting: name => (name ? t('greetingNamed', { firstName: name }) : t('greeting')),
            greetingWithTeam: greeting => t('greetingWithTeam', { greeting }),
            emptySubtitle: t('emptySubtitle'),
            buildPrompt: t('buildPrompt'),
            buildFirst: { title: t('buildFirst.title'), description: t('buildFirst.description') },
            template: { title: t('template.title'), description: t('template.description'), send: t('template.send') },
            guide: { title: t('guide.title'), description: t('guide.description'), send: t('guide.send') },
            checkWorking: (name, mention) => ({ title: t('checkWorking.title', { name }), description: t('checkWorking.description'), send: t('checkWorking.send', { mention }) }),
            checkIdle: (name, mention) => ({ title: t('checkIdle.title', { name }), description: t('checkIdle.description'), send: t('checkIdle.send', { mention }) }),
            handOff: (name, mention) => ({ title: t('handOff.title', { name }), description: t('handOff.description'), prefill: t('handOff.prefill', { mention }) }),
            build: { title: t('build.title'), description: t('build.description') },
        }),
        [t],
    )

    return useMemo(() => (hydrated ? { model: teamEmptyStateOf({ agents, schedules, firstName, now, copy }), now } : null), [hydrated, agents, schedules, firstName, now, copy])
}
