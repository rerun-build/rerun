'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { openDesktopAction } from '@/app/api/_actions/desktop.actions'
import { DesktopScreenLoader } from '@/components/desktop/DesktopScreenLoader'
import { DesktopViewer } from '@/components/desktop/DesktopViewer'
import { ChevronRightIcon, MonitorIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type Screen = { status: 'loading' } | { status: 'live'; socketUrl: string } | { status: 'unavailable'; reason: string }

type AgentComputerThumbnailProps = {
    agentId: string
    working: boolean
    // Why the machine cannot be reached at all: nothing is opened, the reason takes the screen's place.
    disabledReason: string | null
    onOpen: () => void
}

/**
 * What the coworker has in front of it, watched rather than described. A click opens the screen to
 * drive it. Key it on the agent and the reason: it connects once per mount.
 */
export function AgentComputerThumbnail({ agentId, working, disabledReason, onOpen }: AgentComputerThumbnailProps) {
    const t = useTranslations('agent.agentComputerThumbnail')
    const errorText = useErrorText()
    const [screen, setScreen] = useState<Screen>(disabledReason ? { status: 'unavailable', reason: disabledReason } : { status: 'loading' })

    useEffect(() => {
        if (disabledReason) return
        let alive = true
        void openDesktopAction(agentId, 'watch', Intl.DateTimeFormat().resolvedOptions().timeZone).then(opened => {
            if (alive) setScreen(opened.ok ? { status: 'live', socketUrl: opened.socketUrl } : { status: 'unavailable', reason: errorText(opened) })
        })
        return () => {
            alive = false
        }
    }, [agentId, disabledReason, errorText])

    const onDisconnect = useCallback(() => setScreen({ status: 'unavailable', reason: t('wentAway') }), [t])
    const live = screen.status === 'live'

    return (
        <button type="button" disabled={!!disabledReason} onClick={onOpen} className="group w-full space-y-1.5 text-left disabled:cursor-not-allowed">
            <span className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span className={cn('size-1.5 rounded-full', live && working ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                    {live ? (working ? t('working') : t('live')) : t('computer')}
                </span>
                {!disabledReason && <ChevronRightIcon className="size-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />}
            </span>
            <span className="relative flex aspect-[16/7] overflow-hidden rounded-lg border border-border bg-muted/40">
                {screen.status === 'loading' && <DesktopScreenLoader compact className="bg-muted/40" />}
                {screen.status === 'live' && <DesktopViewer viewOnly socketUrl={screen.socketUrl} onDisconnect={onDisconnect} />}
                {screen.status === 'unavailable' && (
                    <span className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-muted-foreground">
                        <MonitorIcon className="size-5" />
                        <span className="text-xs">{screen.reason}</span>
                    </span>
                )}
            </span>
        </button>
    )
}
