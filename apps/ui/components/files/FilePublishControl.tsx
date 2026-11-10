'use client'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyIcon, ExternalLinkIcon, GlobeIcon, Share2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
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
    const t = useTranslations('files.publish')
    const [confirmingUnshare, setConfirmingUnshare] = useState(false)
    const withAccess = !!onShareSettings

    if (!publicUrl) {
        const label = withAccess ? t('publish') : t('publishPublicly')
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
                    <Button size="icon-sm" variant="ghost" title={withAccess ? t('publishedLink') : t('publicLink')} aria-label={withAccess ? t('publishedLink') : t('publicLink')}>
                        <GlobeIcon className="size-4 text-emerald-400" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => window.open(openUrl ?? publicUrl, '_blank', 'noopener,noreferrer')}>
                        <ExternalLinkIcon />
                        {withAccess ? t('open') : t('openPublicLink')}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="whitespace-nowrap" onSelect={() => navigator.clipboard.writeText(publicUrl)}>
                        <CopyIcon />
                        {withAccess ? t('copyLink') : t('copyPublicLink')}
                    </DropdownMenuItem>
                    {onShareSettings && (
                        <DropdownMenuItem className="whitespace-nowrap" onSelect={onShareSettings}>
                            <Share2Icon />
                            {t('shareSettings')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" inset onSelect={() => setConfirmingUnshare(true)}>
                        {withAccess ? t('unpublish') : t('unshare')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {confirmingUnshare && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirmingUnshare(false)}
                    title={withAccess ? t('unpublishTitle', { name }) : t('unshareTitle', { name })}
                    description={withAccess ? t('unpublishDescription') : t('unshareDescription')}
                    confirmLabel={withAccess ? t('unpublish') : t('unshare')}
                    onConfirm={() => {
                        onUnpublish?.()
                        setConfirmingUnshare(false)
                    }}
                />
            )}
        </>
    )
}
