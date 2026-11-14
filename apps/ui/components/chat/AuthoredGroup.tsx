'use client'

import { CardAvatar } from '@rerun/ui/chat'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FORMER_MEMBER, type AuthorProfile } from '@/lib/chat/message-author'

const asIs = (path: string) => path

const firstNameOf = (author: AuthorProfile) => (author.id === FORMER_MEMBER.id ? author.name : author.name.split(' ')[0])

export function AuthoredGroup({ author, children }: { author: AuthorProfile | null; children: ReactNode }) {
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
