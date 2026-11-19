import { hitlVersionOf, type HitlKind, type PendingHitl } from '@moldwright/contracts'
import type { ReactNode } from 'react'

import type { ComposerAttachment } from '../attachments'

export type HitlWidgetProps = {
    pending: PendingHitl
    agentId: string
    coworkerName: string
    onAnswer: (text: string) => void
    onDismiss: () => void
    webUrl: string
    upload?: (attachment: ComposerAttachment) => Promise<string>
    transcribe?: (uri: string) => Promise<string>
}

export type HitlWidget = { maxVersion: number; render: (props: HitlWidgetProps) => ReactNode }

export type HitlWidgets = Partial<Record<HitlKind, HitlWidget>>

export function widgetFor(pending: PendingHitl, widgets: HitlWidgets): HitlWidget | null {
    const widget = widgets[pending.kind]
    if (!widget || hitlVersionOf(pending.input) > widget.maxVersion) return null
    return widget
}
