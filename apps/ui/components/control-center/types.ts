import type { SearchFilter, SearchSource } from '@/lib/control-center/global-search'
import type { BadgeTone } from '@rerun/ui/primitives'
import type { ComponentType } from 'react'

export type ControlRowLeading = { kind: 'agent'; agentId: string } | { kind: 'assistant' } | { kind: 'icon'; icon: ComponentType<{ className?: string }> }

export type ControlRow = {
    // Lowercase and free of spaces: cmdk uses it as the row's selection value.
    id: string
    label: string
    detail?: string
    leading: ControlRowLeading
    badge?: { label: string; tone: BadgeTone }
    // Why the row cannot be run. Written under the label, since a tooltip never opens on touch.
    disabledReason?: string | null
    onSelect: () => void
    // Present when the row opens a page of its own, on Tab or →.
    onDrill?: () => void
    // A hit of the global search: the source it comes from, and the line around the word.
    source?: SearchSource
    snippet?: string
}

export type ControlSection = {
    id: string
    heading: string
    rows: ControlRow[]
    loading?: boolean
    // Said in place of the section when it found nothing.
    emptyMessage?: string
    // Said under the rows, or in place of `emptyMessage`, when some of what it covers was not searched.
    notice?: string
}

export type SourceChip = { value: SearchFilter; label: string; count: number | 'pending' | 'unknown' }
