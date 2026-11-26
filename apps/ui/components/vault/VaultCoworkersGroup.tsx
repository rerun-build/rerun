'use client'

import { CoworkerFace } from '@rerun/ui/inbox'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import type { VaultListing } from '@/app/api/_services/vault.service'
import { Group } from '@/components/connections/AiProvidersPanel'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { PanelRow } from '@/components/ui/panel-row'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ChevronRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { vaultBoxGroups, type VaultBoxGroup } from './vault-boxes'

// What a tall dialog shows of the whole list, every Box together: past it, a face is only drawn once
// scrolled to, since a hundred of them drawn at once freeze the opening.
const FACES_DRAWN_AT_ONCE = 12
const FACE_SIZE = 24

type VaultListedCoworker = VaultListing['coworkers'][number]

type Props = {
    coworkers: VaultListedCoworker[]
    isOn: (coworker: VaultListedCoworker) => boolean
    onToggle: (coworker: VaultListedCoworker, on: boolean) => void
    everyone: boolean
    everyoneReason?: string
    onEveryone?: (on: boolean) => void
    hiddenCoworkers: number
    busy: boolean
}

// Who uses an entry: everyone at once, the Chief of Staff, then the coworkers under the name of their Box.
export function VaultCoworkersGroup({ coworkers, isOn, onToggle, everyone, everyoneReason, onEveryone, hiddenCoworkers, busy }: Props) {
    const t = useTranslations('vault')
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const { chief, groups, loose, drawnAtOnce } = useMemo(() => {
        const arranged = vaultBoxGroups(coworkers, agents, spaces)
        const listed = [...(arranged.chief ? [arranged.chief] : []), ...arranged.groups.flatMap(group => group.coworkers), ...arranged.loose]
        return { ...arranged, drawnAtOnce: new Set(listed.slice(0, FACES_DRAWN_AT_ONCE).map(coworker => coworker.id)) }
    }, [coworkers, agents, spaces])

    const rows = (listed: VaultListedCoworker[]) => listed.map(coworker => <CoworkerRow key={coworker.id} coworker={coworker} drawn={drawnAtOnce.has(coworker.id)} on={isOn(coworker)} locked={everyone || busy} onToggle={on => onToggle(coworker, on)} />)

    return (
        <Group title={t('detail.coworkers')}>
            <div className="space-y-4">
                <div className="space-y-1.5">
                    <TooltipDisabledReason reason={everyoneReason} className="flex w-full">
                        <PanelRow
                            title={t('detail.everyone')}
                            description={t('detail.everyoneHint')}
                            actions={<Switch checked={everyone} disabled={!!everyoneReason || busy} aria-label={t('detail.everyone')} onCheckedChange={onEveryone} />}
                        />
                    </TooltipDisabledReason>
                    {coworkers.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.noCoworkers')}</p>}
                    {chief && rows([chief])}
                </div>
                {groups.map(group => (
                    <BoxSection key={group.id} group={group} on={group.coworkers.filter(isOn).length} startsOpen={!everyone && group.coworkers.some(isOn)}>
                        {rows(group.coworkers)}
                    </BoxSection>
                ))}
                {loose.length > 0 && <div className="space-y-1.5">{rows(loose)}</div>}
                {hiddenCoworkers > 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.hiddenCoworkers', { count: hiddenCoworkers })}</p>}
            </div>
        </Group>
    )
}

function BoxSection({ group, on, startsOpen, children }: { group: VaultBoxGroup<VaultListedCoworker>; on: number; startsOpen: boolean; children: ReactNode }) {
    const t = useTranslations('agent')
    return (
        <Collapsible defaultOpen={startsOpen}>
            <CollapsibleTrigger className="group/box flex h-7 w-full items-center gap-2 rounded px-1 text-start">
                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/box:rotate-90 rtl:group-data-[state=open]/box:-rotate-90" />
                <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">{group.name || t('untitledBox')}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', on > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                    {on}/{group.coworkers.length}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-1">{children}</CollapsibleContent>
        </Collapsible>
    )
}

function CoworkerRow({ coworker, drawn, on, locked, onToggle }: { coworker: VaultListedCoworker; drawn: boolean; on: boolean; locked: boolean; onToggle: (on: boolean) => void }) {
    const t = useTranslations('vault')
    const reason = !coworker.canManage ? t('reasons.manageBox') : undefined
    return (
        <TooltipDisabledReason reason={reason} className="flex w-full">
            <PanelRow
                leading={drawn ? <CoworkerFace agentId={coworker.id} size={FACE_SIZE} /> : <FaceOnceSeen agentId={coworker.id} />}
                title={coworker.name}
                actions={<Switch checked={on} disabled={!!reason || locked} aria-label={coworker.name} onCheckedChange={onToggle} />}
            />
        </TooltipDisabledReason>
    )
}

function FaceOnceSeen({ agentId }: { agentId: string }) {
    const ref = useRef<HTMLSpanElement>(null)
    const [seen, setSeen] = useState(false)

    useEffect(() => {
        const element = ref.current
        if (!element) return
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) setSeen(true)
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    if (seen) return <CoworkerFace agentId={agentId} size={FACE_SIZE} />
    return <span ref={ref} aria-hidden className="shrink-0" style={{ width: FACE_SIZE, height: FACE_SIZE }} />
}
