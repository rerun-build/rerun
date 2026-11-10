'use client'

import { Suggestion, Suggestions } from '../chat/Suggestion'
import { cn } from '../cn'
import { LayerUpIcon } from '../icons'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'
import { useKitTranslations } from '../locale'

export type AgentPickerRow = {
    id: string
    name: string
    disabled: boolean
    // The tab the row opens on, under the name the user reads. With it the row reads as an action.
    tab?: string
}

type AgentPickerListProps<Row extends AgentPickerRow> = {
    rows: Row[]
    selectedId: string | null
    onPick: (row: Row) => void
}

export function AgentPickerList<Row extends AgentPickerRow>({ rows, selectedId, onPick }: AgentPickerListProps<Row>) {
    const t = useKitTranslations()
    if (rows.length === 0) return null

    return (
        <Suggestions className="pb-2">
            {rows.map(row => (
                <Suggestion
                    key={`${row.id}:${row.tab ?? ''}`}
                    suggestion={row.name}
                    onClick={() => onPick(row)}
                    variant={row.id === selectedId ? 'secondary' : 'outline'}
                    aria-pressed={row.id === selectedId}
                    className={cn('max-w-full gap-0 px-3.5', row.disabled && 'text-muted-foreground')}
                >
                    <AgentBuddy agentId={row.id} mood={row.disabled ? 'asleep' : 'idle'} size={20} animated={false} facing="right" className="mr-1.5" />
                    <span className="truncate">{row.tab ? t('foreman.agentPicker.openTab', { tab: row.tab, name: row.name }) : row.name}</span>
                    <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-200 ease-out group-hover/button:grid-cols-[1fr] group-hover/button:opacity-100 group-focus-visible/button:grid-cols-[1fr] group-focus-visible/button:opacity-100 motion-reduce:transition-none">
                        <span className="overflow-hidden">
                            <LayerUpIcon className="ml-1.5 size-3.5 -translate-x-1 transition-[translate] duration-200 ease-out group-hover/button:translate-x-0 group-focus-visible/button:translate-x-0" />
                        </span>
                    </span>
                </Suggestion>
            ))}
        </Suggestions>
    )
}
