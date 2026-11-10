import { useEffect, useRef, useState } from 'react'
import { BorderBeam, type BorderBeamProps, TextShimmer } from '@rerun/ui'
import { BuddyPip } from '@rerun/ui/inbox'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { Streamdown } from 'streamdown'
import { ArrowRight, XIcon, type LucideIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

const streamdownPlugins = { cjk, code, math, mermaid }

interface NotificationToastProps {
    title: string
    message: string
    agentId?: string | null
    Icon: LucideIcon
    iconColor?: string
    beamTone: BorderBeamProps['tone']
    onDismiss: () => void
    onOpen?: () => void
}

export function NotificationToast({ title, message, agentId, Icon, iconColor, beamTone, onDismiss, onOpen }: NotificationToastProps) {
    const t = useTranslations('notifications.toast')
    const messageRef = useRef<HTMLDivElement>(null)
    const [isOverflowing, setIsOverflowing] = useState(false)
    useEffect(() => {
        const el = messageRef.current
        if (el) setIsOverflowing(el.scrollHeight > el.clientHeight)
    }, [message])

    return (
        // `select-none` : sonner abandonne le geste de swipe dès qu'une sélection de texte existe,
        // et un drag sur le markdown en démarre une, ce qui rendait ce toast impossible à balayer.
        <div className="group relative flex w-full select-none items-start gap-3 overflow-hidden rounded-[var(--radius)] border border-border bg-popover px-4 py-3 shadow-lg max-sm:gap-2.5 max-sm:px-3 max-sm:py-2">
            <BorderBeam animated pattern="arcs" tone={beamTone} glow width={1} duration={7} />
            <button
                type="button"
                onClick={onDismiss}
                aria-label={t('close')}
                className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
            >
                <XIcon className="size-3.5" />
            </button>
            {agentId ? (
                <AgentBuddy agentId={agentId} size={32} facing="right" className="mt-0.5" badge={<BuddyPip icon={Icon} className={iconColor} />} />
            ) : (
                <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/50 max-sm:size-7 ${iconColor ?? ''}`}>
                    <Icon className="size-4" />
                </span>
            )}
            <div className="min-w-0 flex-1">
                <p className="pr-6 text-sm font-medium text-foreground">{title}</p>
                <div className="relative">
                    <div
                        ref={messageRef}
                        className="mt-0.5 max-h-32 overflow-hidden break-words text-sm text-foreground/80 max-sm:max-h-10 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0 [&_pre]:my-1"
                    >
                        <Streamdown plugins={streamdownPlugins}>{message}</Streamdown>
                    </div>
                    {isOverflowing && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-popover to-transparent" />
                    )}
                </div>
                {onOpen && (
                    <div className="mt-2 flex justify-end max-sm:mt-1.5">
                        <button
                            type="button"
                            onClick={onOpen}
                            className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-foreground/5 px-3 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-muted-foreground/40 hover:bg-foreground/10 max-sm:py-0.5"
                        >
                            <TextShimmer
                                as="span"
                                spread={4}
                                duration={2.5}
                                className="[--shimmer-base:var(--muted-foreground)] [--shimmer-highlight:var(--foreground)]"
                            >
                                {t('openConversation')}
                            </TextShimmer>
                            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
