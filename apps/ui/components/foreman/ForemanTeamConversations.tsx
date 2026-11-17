'use client'

import type { UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

import { listTeamForemanConversationsAction, readTeamForemanConversationAction, type TeamForemanConversationEntry } from '@/app/api/_actions/foreman-conversation.actions'
import { ChatRow } from '@/components/agent/sheet/AgentChatsList'
import { MessageView } from '@/components/chat/MessageView'
import { historyEntryOf } from '@/components/foreman/useForemanThreads'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonChat, SkeletonList } from '@/components/ui/skeleton'
import { ChevronLeftIcon, MessagesSquare } from '@/lib/icons'

type Member = { ownerId: string; name: string; conversations: TeamForemanConversationEntry[] }

/**
 * For an admin: what the other members asked the Chief of Staff, member by member, each conversation
 * opened to read. Only its owner continues one, so nothing here writes to it.
 */
export function ForemanTeamConversations({ agentRowId }: { agentRowId: string }) {
    const t = useTranslations('workspaceView.foreman.team')
    const [conversations, setConversations] = useState<TeamForemanConversationEntry[] | null>(null)
    const [opened, setOpened] = useState<TeamForemanConversationEntry | null>(null)

    useEffect(() => {
        let cancelled = false
        void listTeamForemanConversationsAction().then(list => {
            if (!cancelled) setConversations(list)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const members = useMemo(() => {
        const byOwner = new Map<string, Member>()
        for (const conversation of conversations ?? []) {
            const member = byOwner.get(conversation.ownerId) ?? { ownerId: conversation.ownerId, name: conversation.ownerName ?? t('unknownMember'), conversations: [] }
            member.conversations.push(conversation)
            byOwner.set(conversation.ownerId, member)
        }
        return [...byOwner.values()]
    }, [conversations, t])

    if (opened) return <TeamTranscript agentRowId={agentRowId} conversation={opened} onBack={() => setOpened(null)} />
    if (!conversations) return <SkeletonList rows={6} className="p-3" />
    if (!members.length) return <EmptyState className="h-full" icon={MessagesSquare} title={t('emptyTitle')} description={t('emptyDescription')} />

    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
            {members.map(member => (
                <section key={member.ownerId} aria-label={member.name}>
                    <h3 className="truncate px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{member.name}</h3>
                    {member.conversations.map(conversation => (
                        <ChatRow key={conversation.id} entry={historyEntryOf({ ...conversation, id: conversation.id ?? '' })} active={false} running={conversation.status === 'working'} adopting={false} onOpen={() => setOpened(conversation)} />
                    ))}
                </section>
            ))}
        </div>
    )
}

function TeamTranscript({ agentRowId, conversation, onBack }: { agentRowId: string; conversation: TeamForemanConversationEntry; onBack: () => void }) {
    const t = useTranslations('workspaceView.foreman.team')
    const [messages, setMessages] = useState<UIMessage[] | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        void readTeamForemanConversationAction(conversation.id ?? '').then(read => {
            if (cancelled) return
            if (read) setMessages(read)
            else setFailed(true)
        })
        return () => {
            cancelled = true
        }
    }, [conversation.id])

    const owner = conversation.ownerName ?? t('unknownMember')
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
                <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('back')} className="min-w-0 shrink pl-1.5">
                    <ChevronLeftIcon className="size-4" />
                    <span className="truncate">{conversation.title}</span>
                </Button>
                <span className="ml-auto shrink-0 truncate pr-1 text-xs text-muted-foreground">{owner}</span>
            </div>
            <p className="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">{t('readOnly', { name: owner })}</p>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {failed ? (
                    <EmptyState className="h-full" icon={MessagesSquare} title={t('unreadableTitle')} description={t('unreadableDescription')} />
                ) : messages ? (
                    <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-4 p-4">
                        {messages.map(message => (
                            <MessageView key={message.id} message={message} agentId={agentRowId} />
                        ))}
                    </div>
                ) : (
                    <SkeletonChat className="mx-auto w-full max-w-[48rem] p-4" />
                )}
            </div>
        </div>
    )
}
