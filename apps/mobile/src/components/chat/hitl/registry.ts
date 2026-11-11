import { hitlVersionOf, type HitlKind, type PendingHitl } from '@rerun/contracts'
import type { ReactNode } from 'react'

import type { ComposerAttachment } from '../attachments'

export type HitlWidgetProps = {
    pending: PendingHitl
    // The coworker the block belongs to, for the widgets that write onto it.
    agentId: string
    coworkerName: string
    onAnswer: (text: string) => void
    // Closes the block and stops the run, as the web's close button does.
    onDismiss: () => void
    // Where the conversation opens on the web, for what only the web can do.
    webUrl: string
    // What an answer can carry on top of its text. The composer owns both while it is on screen; a
    // widget that takes its place has to be handed them, or it draws neither button.
    upload?: (attachment: ComposerAttachment) => Promise<string>
    transcribe?: (uri: string) => Promise<string>
}

// A block the app draws natively, up to the input version it was written for.
export type HitlWidget = { maxVersion: number; render: (props: HitlWidgetProps) => ReactNode }

export type HitlWidgets = Partial<Record<HitlKind, HitlWidget>>

// Null when the app has no widget for this kind, or only one older than the input: the fallback card
// shows what is asked instead.
export function widgetFor(pending: PendingHitl, widgets: HitlWidgets): HitlWidget | null {
    const widget = widgets[pending.kind]
    if (!widget || hitlVersionOf(pending.input) > widget.maxVersion) return null
    return widget
}
