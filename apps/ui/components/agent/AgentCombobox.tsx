'use client'

import { Combobox, type ComboboxGroup } from '@/components/ui/combobox'
import { useBoardStore } from '@/stores/board.store'
import type { IsoAgent } from '@/lib/board/types'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

type BaseProps = {
    placeholder?: string
    disabled?: boolean
    className?: string
    leadingGroup?: ComboboxGroup
    exclude?: string[]
}

type SingleProps = BaseProps & {
    multiple?: false
    value: string | undefined
    onChange: (agentId: string) => void
}

type MultiProps = BaseProps & {
    multiple: true
    value: string[]
    onChange: (agentIds: string[]) => void
}

export function AgentCombobox({ leadingGroup, exclude, ...props }: SingleProps | MultiProps) {
    const t = useTranslations('agent.agentCombobox')
    const tAgent = useTranslations('agent')
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)

    const groups = useMemo<ComboboxGroup[]>(() => {
        const bySpace = new Map<string, IsoAgent[]>()
        // Un agent éteint ne peut être la cible de rien : le proposer ne mènerait qu'à un refus.
        for (const agent of agents.filter(a => !a.disabledAt && !exclude?.includes(a.id))) {
            const list = bySpace.get(agent.spaceId)
            if (list) list.push(agent)
            else bySpace.set(agent.spaceId, [agent])
        }
        const toGroup = (id: string, name: string, spaceAgents: IsoAgent[]): ComboboxGroup => ({
            id,
            heading: name,
            options: spaceAgents.map(a => ({ value: a.id, label: a.name, keywords: [a.name, name], leading: <AgentBuddy agentId={a.id} size={20} animated={false} facing="right" /> })),
        })
        const result: ComboboxGroup[] = []
        for (const space of spaces) {
            const spaceAgents = bySpace.get(space.id)
            if (spaceAgents) result.push(toGroup(space.id, space.name || tAgent('untitledBox'), spaceAgents))
            bySpace.delete(space.id)
        }
        for (const [spaceId, spaceAgents] of bySpace) {
            result.push(toGroup(spaceId, t('unassigned'), spaceAgents))
        }
        return leadingGroup ? [leadingGroup, ...result] : result
    }, [agents, spaces, leadingGroup, exclude, t, tAgent])

    return (
        <Combobox
            {...props}
            groups={groups}
            placeholder={props.placeholder ?? (props.multiple ? t('selectMany') : t('selectOne'))}
            searchPlaceholder={t('search')}
            emptyText={t('empty')}
        />
    )
}
