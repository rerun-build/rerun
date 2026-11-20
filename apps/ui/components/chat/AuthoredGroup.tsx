'use client'

import { CardAvatar } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Orb } from '@/components/foreman/Orb'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useForemanName } from '@/hooks/useForemanName'
import { FORMER_MEMBER, type AuthorProfile } from '@/lib/chat/message-author'

const asIs = (path: string) => path

const AVATAR_SIZE = 28

const firstNameOf = (author: AuthorProfile) => (author.id === FORMER_MEMBER.id ? author.name : author.name.split(' ')[0])

/**
 * Consecutive messages one person sent, signed once by their avatar at the foot of the group.
 * A `null` author is one not resolved yet: the avatar's place is held so the bubbles never shift.
 * `relayed`: the Chief of Staff sent them in that person's name, so it signs them, and says for whom.
 */
export function AuthoredGroup({ author, relayed = false, children }: { author: AuthorProfile | null; relayed?: boolean; children: ReactNode }) {
    if (relayed) return <RelayedGroup author={author}>{children}</RelayedGroup>
    return (
        <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
            {author ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="shrink-0">
                            <CardAvatar src={author.photo} fileUrl={asIs} name={author.name} className="size-7" />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">{firstNameOf(author)}</TooltipContent>
                </Tooltip>
            ) : (
                <Skeleton className="size-7 shrink-0 rounded-full" />
            )}
        </div>
    )
}

function RelayedGroup({ author, children }: { author: AuthorProfile | null; children: ReactNode }) {
    const t = useTranslations('chat.message')
    const foreman = useForemanName()
    return (
        <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {children}
                {author ? <span className="max-w-full self-end truncate text-xs text-muted-foreground">{t('relayedFor', { ...foreman, person: firstNameOf(author) })}</span> : <Skeleton className="h-3 w-28 self-end" />}
            </div>
            <span className="mb-5 shrink-0">
                <Orb size={AVATAR_SIZE} paused />
            </span>
        </div>
    )
}
