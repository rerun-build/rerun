import { crewSnapshotOf, type CrewMember, type CrewState } from '@rerun/contracts'

import { minutesSince, type HomeCoworker, type HomeTranslator } from '@/components/home/board'

export type CrewWidgetMember = {
    id: string
    name: string
    state: CrewState
    line: string
    // `You` for whoever waits, `Stopped` after an error, the minutes at work otherwise.
    badge: string
    // The buddy as a picture in the folder the widgets share with the app; empty before it is drawn.
    face: string
    // Where a tap on its row lands: the conversation it waits or works in.
    url: string
    // When it started waiting or working, for the clocks of the Live Activity that run on their own.
    since: string | null
}

// Everything a widget draws, worded here: a widget runs apart from the app, with no translations.
export type CrewWidgetProps = {
    headline: string
    crewLabel: string
    needsYouLabel: string
    count: number
    countCaption: string
    asksLine: string
    othersLine: string
    members: CrewWidgetMember[]
}

export const EMPTY_CREW_WIDGET: CrewWidgetProps = { headline: '', crewLabel: '', needsYouLabel: '', count: 0, countCaption: '', asksLine: '', othersLine: '', members: [] }

export const faceFileName = (agentId: string, state: CrewState) => `buddy-${agentId.replace(/[^\w-]/g, '')}-${state}.png`

function headlineOf(waiting: number, working: number, t: HomeTranslator): string {
    if (waiting && working) return t('widgets.headline.both', { waiting, working })
    if (waiting) return t('widgets.headline.waiting', { waiting })
    if (working) return t('widgets.headline.working', { working })
    return t('widgets.headline.none')
}

function badgeOf(member: CrewMember, now: number, t: HomeTranslator): string {
    if (member.state === 'waiting') return t('widgets.you')
    if (member.state === 'error') return t('widgets.stopped')
    return t('widgets.minutes', { count: minutesSince(member.since, now) ?? 0 })
}

export function crewWidgetPropsOf(coworkers: readonly HomeCoworker[], t: HomeTranslator, facesDirectory: string | null, now = Date.now()): CrewWidgetProps {
    const snapshot = crewSnapshotOf(coworkers, t)
    const conversationOf = new Map(coworkers.map(coworker => [coworker.id, coworker.latest?.id ?? coworker.generalSessionId ?? 'new']))
    const members = snapshot.members.map(
        (member): CrewWidgetMember => ({
            id: member.id,
            name: member.name,
            state: member.state,
            line: member.line,
            badge: badgeOf(member, now, t),
            face: facesDirectory ? `${facesDirectory}/${faceFileName(member.id, member.state)}` : '',
            url: `rerun://chat/${conversationOf.get(member.id)}?to=${encodeURIComponent(member.id)}`,
            since: member.since,
        })
    )
    const first = members[0]
    const others = snapshot.working - (first?.state === 'working' ? 1 : 0)
    return {
        headline: headlineOf(snapshot.waiting, snapshot.working, t),
        crewLabel: t('widgets.crew'),
        needsYouLabel: t('widgets.needsYou'),
        count: snapshot.working,
        countCaption: snapshot.working ? t('widgets.atWork') : t('widgets.allDone'),
        asksLine: first?.state === 'waiting' ? t('widgets.asks', { name: first.name }) : (first?.name ?? ''),
        othersLine: others > 0 ? t('widgets.othersAtWork', { count: others }) : '',
        members,
    }
}
