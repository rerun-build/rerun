import type { BadgeTone } from '@rerun/ui/primitives'
import type { ComponentType } from 'react'

export type ControlRowLeading = { kind: 'agent'; agentId: string } | { kind: 'assistant' } | { kind: 'icon'; icon: ComponentType<{ className?: string }> }

export type ControlRow = {
    id: string
    label: string
    detail?: string
    leading: ControlRowLeading
    badge?: { label: string; tone: BadgeTone }
    disabledReason?: string | null
    onSelect: () => void
    onDrill?: () => void
}

export type ControlSection = {
    id: string
    heading: string
    rows: ControlRow[]
    loading?: boolean
}
