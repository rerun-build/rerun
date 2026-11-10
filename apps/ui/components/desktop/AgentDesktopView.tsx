'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import type { DesktopApp, DesktopViewMode } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { finishTakeoverAction, launchDesktopAppAction, openDesktopAction, startTakeoverAction } from '@/app/api/_actions/desktop.actions'
import { DesktopNotch } from '@/components/desktop/DesktopNotch'
import { DesktopScreenLoader } from '@/components/desktop/DesktopScreenLoader'
import { DesktopViewer, type DesktopViewerHandle } from '@/components/desktop/DesktopViewer'
import { DesktopDialog } from '@/components/dialogs/DesktopDialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { MonitorIcon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'
import { useDesktopStore, type TakeoverTarget } from '@/stores/desktop.store'

type Screen = { status: 'loading' } | { status: 'live'; socketUrl: string; dock: boolean } | { status: 'error'; refusal: Refusal } | { status: 'disconnected' }

const openScreen = (agentId: string, mode: DesktopViewMode) => openDesktopAction(agentId, mode, Intl.DateTimeFormat().resolvedOptions().timeZone)

async function connect(agentId: string, takeover: TakeoverTarget | null): Promise<Screen> {
    if (takeover) {
        const started = await startTakeoverAction(agentId, takeover.url)
        if (!started.ok) return { status: 'error', refusal: started }
    }
    const opened = await openScreen(agentId, 'drive')
    return opened.ok ? { status: 'live', socketUrl: opened.socketUrl, dock: opened.dock } : { status: 'error', refusal: opened }
}

// The screen of the agent whose sheet is open, in a dialog to drive it. Watching it happens in that
// agent's chat. It follows the sheet: another agent, or no sheet at all, closes it.
export function AgentDesktopView() {
    const t = useTranslations('desktop.session')
    const agentId = useDesktopStore(s => s.agentId)
    const takeover = useDesktopStore(s => s.takeover)
    const close = useDesktopStore(s => s.close)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const agentName = useBoardStore(s => s.agents.find(agent => agent.id === agentId)?.name)

    useEffect(() => {
        if (agentId && selectedAgentId !== agentId) close()
    }, [agentId, selectedAgentId, close])

    return (
        <DesktopDialog
            open={!!agentId}
            onOpenChange={open => {
                if (!open) close()
            }}
            title={takeover ? takeover.reason : agentName ? t('title', { name: agentName }) : t('titleFallback')}
            description={takeover ? t('takeoverDescription') : t('description')}
        >
            {agentId && <DesktopSession key={`${agentId}:${takeover?.callId ?? 'desktop'}`} agentId={agentId} takeover={takeover} />}
        </DesktopDialog>
    )
}

function DesktopSession({ agentId, takeover }: { agentId: string; takeover: TakeoverTarget | null }) {
    const t = useTranslations('desktop')
    const errorText = useErrorText()
    const handBack = useDesktopStore(s => s.handBack)
    const [screen, setScreen] = useState<Screen>({ status: 'loading' })
    const [busy, setBusy] = useState(false)
    const [browsing, setBrowsing] = useState(false)
    const viewerRef = useRef<DesktopViewerHandle>(null)
    // Two clicks on Done would hand the browser back twice, and resume the run twice.
    const finishingRef = useRef(false)
    const browsingRef = useRef(false)

    useEffect(() => {
        let alive = true
        void connect(agentId, takeover).then(result => {
            if (alive) setScreen(result)
        })
        return () => {
            alive = false
            // A browser opened from the notch holds the agent's profile for as long as it is open, so
            // it closes with the view instead of being left to its fifteen-minute limit.
            if (browsingRef.current) void finishTakeoverAction(agentId)
        }
        // Mounted once per session: the parent remounts this component for another agent or takeover.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const reconnect = async () => {
        setScreen({ status: 'loading' })
        setScreen(await connect(agentId, takeover))
    }

    const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
        setBusy(true)
        const result = await action()
        setBusy(false)
        if (!result.ok) toast.error(errorText(result))
        return result.ok
    }

    const openApp = (app: DesktopApp) => void run(() => launchDesktopAppAction(agentId, app))

    const toggleBrowser = async () => {
        const next = !browsing
        if (!(await run(() => (next ? startTakeoverAction(agentId) : finishTakeoverAction(agentId)))) && next) return
        browsingRef.current = next
        setBrowsing(next)
    }

    const paste = async () => {
        try {
            viewerRef.current?.paste(await navigator.clipboard.readText())
        } catch {
            toast.error(t('session.clipboardDenied'))
        }
    }

    const done = async () => {
        if (!takeover || finishingRef.current) return
        finishingRef.current = true
        setBusy(true)
        const result = await finishTakeoverAction(agentId, { keepOpen: true })
        setBusy(false)
        if (!result.ok) {
            finishingRef.current = false
            toast.error(errorText(result))
            return
        }
        handBack(takeover.callId, { url: result.url, open: result.open })
    }

    const onDisconnect = useCallback(() => setScreen({ status: 'disconnected' }), [])
    const live = screen.status === 'live'

    return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-muted/40">
            {screen.status === 'loading' && <DesktopScreenLoader label={t('screen.connecting')} />}
            {screen.status === 'live' && <DesktopViewer ref={viewerRef} socketUrl={screen.socketUrl} onDisconnect={onDisconnect} />}
            {screen.status === 'error' && <EmptyState icon={MonitorIcon} title={t('screen.unavailable')} description={errorText(screen.refusal)} action={<RetryButton onClick={() => void reconnect()} label={t('session.tryAgain')} />} />}
            {screen.status === 'disconnected' && <EmptyState icon={MonitorIcon} title={t('screen.wentAway')} description={t('session.disconnectedDescription')} action={<RetryButton onClick={() => void reconnect()} label={t('session.reconnect')} />} />}
            <DesktopNotch
                launchers={screen.status === 'live' && !screen.dock}
                browsing={browsing}
                browserLockedReason={takeover ? t('session.takeoverHoldsBrowser') : undefined}
                disabled={!live || busy}
                takeoverReason={takeover?.reason}
                onOpenApp={openApp}
                onToggleBrowser={() => void toggleBrowser()}
                onPaste={() => void paste()}
                onDone={takeover ? () => void done() : undefined}
            />
        </div>
    )
}

function RetryButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <Button size="sm" variant="outline" onClick={onClick}>
            {label}
        </Button>
    )
}
