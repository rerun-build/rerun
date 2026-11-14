'use client'

import { useTranslations } from 'next-intl'
import { memo, useMemo } from 'react'

import { AgentLockedOverlay } from '@/components/agent/AgentLockedOverlay'
import { AgentPanelChat } from '@/components/agent/AgentPanelChat'
import type { ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { WorkspacePausedBanner } from '@/components/layout/WorkspacePausedBanner'
import { Button } from '@/components/ui/button'
import { Skeleton, SkeletonChat } from '@/components/ui/skeleton'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { useDetailsOpen } from '@/components/workspace-view/useDetailsOpen'
import { useOpenedAgents } from '@/hooks/useOpenedAgents'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import { PanelRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'

type SimpleChatPaneProps = {
    chats: ChatsFilter | null
    onChatsChange: (chats: ChatsFilter | null) => void
    // The coworker a new conversation was asked for, until its chat has opened one.
    newThreadFor: string | null
    onNewThreadConsumed: () => void
    // A conversation one of the card's screens asked to open (a run in the activity, a thread).
    openSessionRequest: { sessionId: string; title: string; runId: string | null } | null
    onOpenSessionConsumed: () => void
    // Until the frame has picked who opens first: the middle shows the shape of a chat, not an invitation to pick one.
    settling: boolean
}

/**
 * The middle of the Simple view: the open coworker's chat, its conversations as tabs above it. The
 * last few coworkers stay mounted behind it, hidden, so a reply still streaming is never cut. Memoised:
 * opening the card beside it re-renders neither it nor the chats it holds.
 */
export const SimpleChatPane = memo(function SimpleChatPane({ chats, onChatsChange, newThreadFor, onNewThreadConsumed, openSessionRequest, onOpenSessionConsumed, settling }: SimpleChatPaneProps) {
    const t = useTranslations('workspaceView.chat')
    const tAgent = useTranslations('agent')
    const agents = useBoardStore(s => s.agents)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const sessions = useBoardStore(s => s.sessions)
    const openedAgentIds = useOpenedAgents()
    const { access } = useWorkspaceAccess()
    const agent = agents.find(a => a.id === selectedAgentId)
    // A coworker switched off, or a paused workspace, has nothing to show: its thread would describe one that runs.
    const locked = !!agent && (access !== 'live' || !!agent.disabledAt)
    const attentionCount = useMemo(() => sessions.filter(s => s.agentId === selectedAgentId && ATTENTION_STATUSES.has(s.status)).length, [sessions, selectedAgentId])

    const headerEnd = <DetailsToggle />

    return (
        <section aria-label={agent?.name} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
            {openedAgentIds.map(id => (
                <div key={id} className={selectedAgentId === id ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                    <AgentPanelChat
                        presentation="docked"
                        agentId={id}
                        agentName={agents.find(a => a.id === id)?.name ?? tAgent('panelsShared.yourCoworker')}
                        selected={selectedAgentId === id && !locked}
                        chats={selectedAgentId === id && !locked ? chats : null}
                        onCloseChats={() => onChatsChange(null)}
                        onOpenChats={() => onChatsChange('all')}
                        chatsAttention={selectedAgentId === id ? attentionCount : 0}
                        headerEnd={headerEnd}
                        openSessionRequest={selectedAgentId === id ? openSessionRequest : null}
                        onOpenSessionConsumed={onOpenSessionConsumed}
                        newThreadRequest={newThreadFor === id}
                        onNewThreadConsumed={onNewThreadConsumed}
                    />
                </div>
            ))}
            {agent && locked && (
                <div className="absolute inset-0 z-10 flex flex-col bg-background">
                    <AgentLockedOverlay agent={agent} />
                </div>
            )}
            {!agent && (settling ? <ChatPaneSkeleton /> : <p className="m-auto px-6 text-center text-sm text-muted-foreground">{t('pick')}</p>)}
            <WorkspacePausedBanner />
        </section>
    )
})

function DetailsToggle() {
    const t = useTranslations('workspaceView.chat')
    const open = useDetailsOpen()
    return (
        <TooltipLabeled label={t('card')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('card')} aria-pressed={open} onClick={() => useSimpleDetailsStore.getState().setWanted(!open)} className={cn(open && 'bg-accent')}>
                <PanelRightIcon className="size-4" />
            </Button>
        </TooltipLabeled>
    )
}

const TAB_WIDTHS = ['w-16', 'w-28']

// The docked chat's frame: its tabs and their two buttons, the conversation's column, the composer.
function ChatPaneSkeleton() {
    return (
        <div aria-hidden className="flex h-full flex-col">
            <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border pr-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 px-3">
                    {TAB_WIDTHS.map(width => (
                        <Skeleton key={width} className={cn('h-7 rounded-md', width)} />
                    ))}
                </div>
                <Skeleton className="size-8 rounded-md" />
                <Skeleton className="size-8 rounded-md" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                <SkeletonChat className="mx-auto w-full max-w-[48rem] p-4" />
            </div>
            <div className="border-t border-border p-3">
                <div className="mx-auto flex max-w-[48rem] flex-col gap-3 rounded-md border border-border p-2.5">
                    <Skeleton className="h-3.5 w-48" />
                    <div className="flex items-center justify-between pt-6">
                        <Skeleton className="h-6 w-28 rounded-md" />
                        <Skeleton className="size-8 rounded-md" />
                    </div>
                </div>
            </div>
        </div>
    )
}
