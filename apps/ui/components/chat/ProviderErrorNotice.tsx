'use client'

import { NoticeActions, type NoticeAction } from '@/components/chat/NoticeActions'
import { Icon } from '@/components/ui/icon'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { BorderBeam } from '@rerun/ui'
import { AlertTriangleIcon, GaugeIcon, PlugIcon, RotateCwIcon, ScrollTextIcon, ServerIcon, SquareIcon, UnplugIcon } from '@/lib/icons'
import { chatErrorTitle, describeSubscriptionLimit, friendlyError, type ChatErrorKind } from '@/lib/chat-error'
import type { ComponentType } from 'react'

type NoticeKind = Exclude<ChatErrorKind, 'budget'>

const ClaudeGlyph = ({ className }: { className?: string }) => <ProviderIcon provider="claude" className={className} />
const OpenAIGlyph = ({ className }: { className?: string }) => <ProviderIcon provider="openai" className={className} />
const OpencodeGlyph = ({ className }: { className?: string }) => <ProviderIcon provider="opencode" className={className} />

const ICONS: Record<NoticeKind, ComponentType<{ className?: string }>> = {
    usage_limit: GaugeIcon,
    unauthorized: UnplugIcon,
    overloaded: ServerIcon,
    context_window: ScrollTextIcon,
    provider_error: ServerIcon,
    thinking_replay: RotateCwIcon,
    interrupted: RotateCwIcon,
    run_in_flight: RotateCwIcon,
    generic: AlertTriangleIcon,
}

// A spent subscription is the one case where the header says whose plan ran out: a Box can hold a
// Claude plan and a ChatGPT plan at once, and only one of them is out. The brand mark carries that
// faster than any wording, and the title names the window (session, week, Opus) rather than
// repeating "usage limit".
function header(kind: NoticeKind, message: string): { title: string; icon: ComponentType<{ className?: string }> } {
    const title = chatErrorTitle(kind, message) ?? 'Something went wrong'
    if (kind !== 'usage_limit') return { title, icon: ICONS[kind] }
    const plan = describeSubscriptionLimit(message).plan
    if (!plan) return { title, icon: ICONS.usage_limit }
    return { title, icon: plan === 'claude' ? ClaudeGlyph : plan === 'opencode' ? OpencodeGlyph : OpenAIGlyph }
}

// The dead end this replaces: a raw provider stack, or "A run is already in flight on this
// conversation." with nothing to click. Every kind here says what happened and, where there is one,
// offers the move that fixes it.
export function ProviderErrorNotice({ kind, message, onSwitchModel, onOpenConnections, onReconnect, onStopRun, onContinue, onRetry }: { kind: NoticeKind; message: string; onSwitchModel?: () => void; onOpenConnections?: () => void; onReconnect?: () => void; onStopRun?: () => void; onContinue?: () => void; onRetry?: () => void }) {
    const { title, icon } = header(kind, message)

    const actions: NoticeAction[] = []
    if (kind === 'run_in_flight' && onStopRun) {
        actions.push({
            key: 'stop',
            leading: <Icon icon={SquareIcon} size="sm" />,
            title: 'Stop this run',
            cta: 'Stop run',
            description: 'Frees the conversation for your message.',
            onClick: onStopRun,
        })
    }
    if (kind === 'interrupted' && onContinue) {
        actions.push({
            key: 'continue',
            leading: <Icon icon={RotateCwIcon} size="sm" />,
            title: 'Continue the run',
            cta: 'Continue',
            description: 'Picks up where the coworker was cut off.',
            onClick: onContinue,
        })
    }
    // A refusal repeats on every send, so only a transient failure is offered a retry. A rejected
    // thinking replay is the engine's, and a fresh run does not carry it.
    if ((kind === 'overloaded' || kind === 'generic' || kind === 'thinking_replay') && onRetry) {
        actions.push({
            key: 'retry',
            leading: <Icon icon={RotateCwIcon} size="sm" />,
            title: 'Try again',
            cta: 'Retry',
            description: 'Sends your last message again.',
            onClick: onRetry,
        })
    }
    const switchModel = onSwitchModel ?? onOpenConnections
    if ((kind === 'usage_limit' || kind === 'provider_error' || kind === 'context_window' || kind === 'overloaded' || kind === 'generic') && switchModel) {
        actions.push({
            key: 'switch',
            leading: <Icon icon={GaugeIcon} size="sm" />,
            title: 'Switch to another model',
            cta: 'Switch',
            description: onSwitchModel ? 'Pick another model for this conversation.' : 'Pick another connection of this workspace.',
            onClick: switchModel,
        })
    }
    if (kind === 'unauthorized' && onReconnect) {
        actions.push({
            key: 'reconnect',
            leading: <Icon icon={PlugIcon} size="sm" />,
            title: 'Reconnect',
            cta: 'Reconnect',
            description: 'Sign in again on the connection this coworker runs on.',
            onClick: onReconnect,
        })
    }

    return (
        <div className="relative mb-2 space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4">
            <BorderBeam animated pattern="arcs" tone="red" glow width={1} duration={7} />
            <div className="flex items-center gap-2.5 text-sm">
                <Icon size="sm" tone="red" icon={icon} className="bg-red-500/10 text-foreground" />
                <span className="font-medium">{title}</span>
            </div>
            <p className="text-sm">{kind === 'run_in_flight' ? 'A run started earlier is still holding this conversation. Stop it to send your message.' : friendlyError(message)}</p>
            <NoticeActions actions={actions} />
        </div>
    )
}
