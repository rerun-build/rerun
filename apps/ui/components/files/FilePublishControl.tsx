'use client'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyIcon, ExternalLinkIcon, GlobeIcon, Share2Icon } from '@/lib/icons'
import { useState } from 'react'

type FilePublishControlProps = {
    name: string
    publicUrl?: string
    onPublish: () => void
    onUnpublish?: () => void
    // Set once links carry an access: the globe then speaks of a link rather than a public one,
    // opens it through the member round trip, and reaches the share dialog.
    onShareSettings?: () => void
    openUrl?: string
}

export function FilePublishControl({ name, publicUrl, onPublish, onUnpublish, onShareSettings, openUrl }: FilePublishControlProps) {
    const [confirmingUnshare, setConfirmingUnshare] = useState(false)
    const withAccess = !!onShareSettings

    if (!publicUrl) {
        const label = withAccess ? 'Publish' : 'Publish publicly'
        return (
            <Button size="icon-sm" variant="ghost" onClick={onPublish} title={label} aria-label={label}>
                <GlobeIcon className="size-4" />
            </Button>
        )
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" title={withAccess ? 'Published link' : 'Public link'} aria-label={withAccess ? 'Published link' : 'Public link'}>
                        <GlobeIcon className="size-4 text-emerald-400" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => window.open(openUrl ?? publicUrl, '_blank', 'noopener,noreferrer')}>
                        <ExternalLinkIcon />
                        {withAccess ? 'Open' : 'Open public link'}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => navigator.clipboard.writeText(publicUrl)}>
                        <CopyIcon />
                        {withAccess ? 'Copy link' : 'Copy public link'}
                    </DropdownMenuItem>
                    {onShareSettings && (
                        <DropdownMenuItem className="whitespace-nowrap" onSelect={onShareSettings}>
                            <Share2Icon />
                            Share settings
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" inset onSelect={() => setConfirmingUnshare(true)}>
                        {withAccess ? 'Unpublish' : 'Unshare'}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {confirmingUnshare && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirmingUnshare(false)}
                    title={withAccess ? `Unpublish ${name}?` : `Unshare ${name}?`}
                    description={withAccess ? 'The link stops working right away, for everyone who has it.' : 'The public link stops working right away. Anyone holding it gets a 404.'}
                    confirmLabel={withAccess ? 'Unpublish' : 'Unshare'}
                    onConfirm={() => {
                        onUnpublish?.()
                        setConfirmingUnshare(false)
                    }}
                />
            )}
        </>
    )
}
