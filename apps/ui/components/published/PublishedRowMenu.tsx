'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { unpublishLinkAction } from '@/app/api/_actions/publish.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { openPublishedHref } from '@/lib/published/links'
import type { PublishedFile } from '@/lib/services/types'
import { CopyIcon, EllipsisIcon, ExternalLinkIcon, Share2Icon, Trash2Icon } from '@/lib/icons'

export function PublishedRowMenu({ file, onShare, onUnpublished }: { file: PublishedFile; onShare: () => void; onUnpublished: (slug: string) => void }) {
    const [confirming, setConfirming] = useState(false)
    const [pending, setPending] = useState(false)

    const unpublish = async () => {
        setPending(true)
        const result = await unpublishLinkAction(file.slug)
        setPending(false)
        setConfirming(false)
        if (!result.ok) {
            toast.error('Could not unpublish', { description: result.error })
            return
        }
        onUnpublished(file.slug)
    }

    // Every click inside (the menu and the confirmation portal included) would otherwise bubble up
    // the React tree to the row or the card, which opens the share dialog.
    return (
        <span className="contents" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More">
                        <EllipsisIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => window.open(openPublishedHref(file.slug), '_blank', 'noopener,noreferrer')}>
                        <ExternalLinkIcon />
                        Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(file.url)}>
                        <CopyIcon />
                        Copy link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onShare}>
                        <Share2Icon />
                        Share settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                        <Trash2Icon />
                        Unpublish
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {confirming && (
                <ConfirmDialog
                    open
                    onOpenChange={next => !next && setConfirming(false)}
                    title={`Unpublish ${file.title}?`}
                    description="The link stops working right away, for everyone who has it."
                    confirmLabel="Unpublish"
                    pending={pending}
                    onConfirm={() => void unpublish()}
                />
            )}
        </span>
    )
}
