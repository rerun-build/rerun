'use client'

import { Orb } from '@rerun/ui/foreman'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

import { AgentComputerThumbnail } from '@/components/agent/sheet/AgentComputerThumbnail'
import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import { useComputerEnabled } from '@/components/layout/FeatureFlagsProvider'
import { Button } from '@/components/ui/button'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { BlocksIcon, BrainIcon, CalendarClockIcon, ChevronRightIcon, FolderIcon, Layers, MessagesSquare, SettingsIcon, TableIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useDesktopStore } from '@/stores/desktop.store'
import { foremanOrbState, selectForemanOpen, useForemanStore, type ForemanCardScreen } from '@/stores/foreman.store'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'

type IconType = ComponentType<{ className?: string }>

const TILES: { screen: ForemanCardScreen; icon: IconType; label: 'services' | 'skills' | 'memories' | 'scheduled' }[] = [
    { screen: 'services', icon: BlocksIcon, label: 'services' },
    { screen: 'skills', icon: Layers, label: 'skills' },
    { screen: 'memories', icon: BrainIcon, label: 'memories' },
    { screen: 'routines', icon: CalendarClockIcon, label: 'scheduled' },
]

const ROWS: { screen: ForemanCardScreen; icon: IconType; label: 'files' | 'data' }[] = [
    { screen: 'files', icon: FolderIcon, label: 'files' },
    { screen: 'data', icon: TableIcon, label: 'data' },
]

/**
 * The Chief of Staff's card, the coworker's card without what code holds for it (its name, its Box,
 * sharing, deleting): what it has at hand and the screen it looks at. Until its row is known (the
 * onboarding, a hub conversation) it keeps only the workspace's routines.
 */
// `closeBar`: false over the chat on the board, where its header's card button and tabs close it.
export function ForemanCard({ onOpen, onClose, closeBar }: { onOpen: (screen: ForemanCardScreen) => void; onClose: () => void; closeBar: boolean }) {
    const t = useTranslations('workspaceView.foreman')
    const tCard = useTranslations('agent.agentCard')
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)
    const agentRowId = useForemanStore(state => state.agentRowId)
    const servicesNeedConfig = useConnectorServices(agentRowId ?? undefined).needsConfig
    const computerEnabled = useComputerEnabled()
    const openDesktop = useDesktopStore(state => state.openDesktop)
    const { needsMachineReason } = useWorkspaceAccess()
    const tiles = agentRowId ? TILES : TILES.filter(tile => tile.screen === 'routines')
    // What the other members asked it is read by an admin only, as the server holds it.
    const isAdmin = useIsWorkspaceAdmin()
    const rows = [
        ...ROWS.map(row => ({ ...row, label: tCard(`destinations.${row.label}`) })),
        ...(isAdmin ? [{ screen: 'team' as const, icon: MessagesSquare, label: t('team.title') }] : []),
    ]

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {closeBar && (
                <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border px-3">
                    <Button aria-label={tCard('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                        <XIcon className="size-4" />
                    </Button>
                </div>
            )}
            <div className="flex min-h-0 flex-col overflow-y-auto">
                <div className="flex shrink-0 flex-col items-center px-4 pt-4 pb-3">
                    <Orb size={WELCOME_ORB_SIZE} state={foremanOrbState({ open, activity })} />
                    <span className="mt-2 max-w-full truncate text-base leading-tight font-semibold">{t('name')}</span>
                    <span className="text-xs text-muted-foreground">{t('line')}</span>
                </div>
                <div className={cn('grid shrink-0 gap-1.5 px-3 pb-3', tiles.length === TILES.length ? 'grid-cols-4' : 'grid-cols-1')}>
                    {tiles.map(({ screen, icon: Glyph, label }) => (
                        <Button key={screen} variant="outline" onClick={() => onOpen(screen)} className="relative h-auto min-w-0 flex-col gap-1 py-2 text-[11px]">
                            <Glyph className="size-4" />
                            <span className="max-w-full truncate">{tCard(`destinations.${label}`)}</span>
                            {screen === 'services' && servicesNeedConfig && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-background" />}
                        </Button>
                    ))}
                </div>
                {agentRowId && (
                    <>
                        <div className="shrink-0 space-y-4 px-3 pb-3">
                            <div className="space-y-1.5">
                                {rows.map(({ screen, icon: Glyph, label }) => (
                                    <button key={screen} type="button" onClick={() => onOpen(screen)} className="flex w-full items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-muted">
                                        <Glyph className="size-4 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                                        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                                    </button>
                                ))}
                            </div>
                            {computerEnabled && <AgentComputerThumbnail key={`${agentRowId}:${needsMachineReason}`} agentId={agentRowId} working={activity !== 'idle'} disabledReason={needsMachineReason} onOpen={() => openDesktop(agentRowId)} />}
                        </div>
                        <div className="shrink-0 border-t border-border p-3">
                            <Button variant="outline" size="sm" className="w-full" onClick={() => onOpen('tools')}>
                                <SettingsIcon className="size-4" />
                                {tCard('destinations.settings')}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
