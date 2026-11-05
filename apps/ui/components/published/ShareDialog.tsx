'use client'

import { Stripes } from '@rerun/ui/primitives'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { getPublishedAction, getPublishSettingsAction, unpublishLinkAction, updatePublishedAccessAction, type PublishSettings } from '@/app/api/_actions/publish.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAwaitedThumbnail } from '@/hooks/useAwaitedThumbnail'
import type { AccessChange } from '@/lib/services/publish'
import type { PublishedAccess } from '@/lib/published/access'
import { publishedHostOf } from '@/lib/published/links'
import type { PublishedFile } from '@/lib/services/types'
import { CheckIcon, ChevronDownIcon, LinkIcon, Share2Icon, Trash2Icon, XIcon } from '@/lib/icons'

import { ACCESS_HINT, ACCESS_ORDER, AccessIcon, accessLabel, inviteLabel, useWorkspaceName } from './access'
import { PublishedThumb } from './PublishedThumb'

type ShareDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    slug: string | null
    // What the caller already holds, shown while the live state loads.
    initial?: PublishedFile | null
    onChanged?: (file: PublishedFile) => void
    onUnpublished?: (slug: string) => void
}

export function ShareDialog({ open, onOpenChange, slug, initial, onChanged, onUnpublished }: ShareDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px]" onOpenAutoFocus={event => event.preventDefault()}>
                {open && slug && <ShareDialogBody slug={slug} initial={initial ?? null} onChanged={onChanged} onUnpublished={onUnpublished} onClose={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    )
}

function ShareDialogBody({ slug, initial, onChanged, onUnpublished, onClose }: { slug: string; initial: PublishedFile | null; onChanged?: (file: PublishedFile) => void; onUnpublished?: (slug: string) => void; onClose: () => void }) {
    const workspaceName = useWorkspaceName()
    const [file, setFile] = useState<PublishedFile | null>(initial?.slug === slug ? initial : null)
    const [settings, setSettings] = useState<PublishSettings | null>(null)
    // A mode that needs a password or an invite before it can be saved, picked but not saved yet.
    const [draftAccess, setDraftAccess] = useState<PublishedAccess | null>(null)
    const [saving, setSaving] = useState(false)
    const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)

    useEffect(() => {
        let cancelled = false
        void Promise.all([getPublishedAction(slug), getPublishSettingsAction()]).then(([live, publishSettings]) => {
            if (cancelled) return
            if (live) setFile(live)
            setSettings(publishSettings)
        })
        return () => {
            cancelled = true
        }
    }, [slug])
    useAwaitedThumbnail(file, setFile)

    const save = async (change: AccessChange): Promise<boolean> => {
        setSaving(true)
        const result = await updatePublishedAccessAction(slug, change)
        setSaving(false)
        if (!result.ok) {
            toast.error('Could not update the link', { description: result.error })
            return false
        }
        setFile(result.file)
        setDraftAccess(null)
        onChanged?.(result.file)
        return true
    }

    const pick = (access: PublishedAccess) => {
        if (!file) return
        if (access === 'password' && !file.hasPassword) return setDraftAccess('password')
        if (access === 'invited' && file.invited.length === 0) return setDraftAccess('invited')
        setDraftAccess(null)
        if (access !== file.access) void save({ access })
    }

    const unpublish = async () => {
        const result = await unpublishLinkAction(slug)
        setConfirmingUnpublish(false)
        if (!result.ok) {
            toast.error('Could not unpublish', { description: result.error })
            return
        }
        onUnpublished?.(slug)
        onClose()
    }

    const shownAccess = draftAccess ?? file?.access ?? 'workspace'

    return (
        <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
                <Share2Icon className="size-4 text-muted-foreground" />
                <DialogTitle className="min-w-0 flex-1 truncate text-sm leading-normal">Share</DialogTitle>
                <DialogDescription className="sr-only">Choose who can open this link.</DialogDescription>
                <DialogClose asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Close" className="max-sm:hidden">
                        <XIcon />
                    </Button>
                </DialogClose>
            </div>

            <div className="@container relative h-44 shrink-0 overflow-hidden border-b bg-muted/30">
                <Stripes fade="bottom" />
                <div className="absolute inset-x-12 top-6 -bottom-px overflow-hidden rounded-t-lg shadow-[0_12px_32px_rgba(0,0,0,.18)] ring-1 ring-foreground/10 @max-sm:inset-x-8">
                    {file ? <PublishedThumb file={file} className="aspect-auto h-full rounded-none ring-0" /> : <Skeleton className="size-full rounded-none" />}
                </div>
            </div>

            <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                {file ? (
                    <>
                        <span className="truncate text-sm font-medium">{file.title}</span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">{publishedHostOf(file.url)}</span>
                    </>
                ) : (
                    <>
                        <Skeleton className="h-4 w-2/5" />
                        <Skeleton className="mt-1 h-3 w-1/2" />
                    </>
                )}
            </div>

            {file && shownAccess === 'password' && <PasswordField hasPassword={file.hasPassword && file.access === 'password'} disabled={saving} onSave={password => save({ access: 'password', password })} />}
            {file && shownAccess === 'invited' && <InviteDetail invited={file.access === 'invited' ? file.invited : []} disabled={saving} onSave={invite => save({ access: 'invited', invite })} />}

            <div className="flex items-center justify-between gap-2 px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {file ? (
                    <AccessTrigger
                        access={shownAccess}
                        workspaceName={workspaceName}
                        publicOff={settings?.policy === 'never'}
                        invitesOff={settings ? !settings.invitesAvailable : false}
                        disabled={saving}
                        onPick={pick}
                        onUnpublish={() => setConfirmingUnpublish(true)}
                    />
                ) : (
                    <Skeleton className="h-8 w-40" />
                )}
                <CopyLinkButton url={file?.url ?? null} />
            </div>

            {confirmingUnpublish && file && (
                <ConfirmDialog
                    open
                    onOpenChange={next => !next && setConfirmingUnpublish(false)}
                    title={`Unpublish ${file.title}?`}
                    description="The link stops working right away, for everyone who has it."
                    confirmLabel="Unpublish"
                    onConfirm={() => void unpublish()}
                />
            )}
        </>
    )
}

function AccessTrigger({
    access,
    workspaceName,
    publicOff,
    invitesOff,
    disabled,
    onPick,
    onUnpublish,
}: {
    access: PublishedAccess
    workspaceName: string
    publicOff: boolean
    invitesOff: boolean
    disabled: boolean
    onPick: (access: PublishedAccess) => void
    onUnpublish: () => void
}) {
    const offReason = (mode: PublishedAccess): string | null => {
        if (mode === 'public' && publicOff) return `Turned off for ${workspaceName}`
        if (mode === 'invited' && invitesOff) return 'This server sends no email'
        return null
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="-ml-1.5 min-w-0" disabled={disabled}>
                    <AccessIcon access={access} />
                    <span className="truncate">{accessLabel(access, workspaceName)}</span>
                    <ChevronDownIcon className="text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
                {ACCESS_ORDER.map(mode => {
                    const reason = offReason(mode)
                    return (
                        <DropdownMenuItem key={mode} disabled={!!reason} onSelect={() => onPick(mode)} className="items-start gap-2.5 py-2">
                            <AccessIcon access={mode} className="mt-0.5 size-4 shrink-0" />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span>{accessLabel(mode, workspaceName)}</span>
                                <span className="text-xs text-muted-foreground">{reason ?? ACCESS_HINT[mode]}</span>
                            </span>
                            {access === mode && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
                        </DropdownMenuItem>
                    )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onUnpublish}>
                    <Trash2Icon />
                    Unpublish
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// Never prefilled: only its hash is kept. A password already set reads as one, and typing a new one
// replaces it.
function PasswordField({ hasPassword, disabled, onSave }: { hasPassword: boolean; disabled: boolean; onSave: (password: string) => Promise<boolean> }) {
    const [value, setValue] = useState('')
    // Emptied before the save: Enter disables the field, which blurs it, and the blur must find
    // nothing left to save.
    const commit = async () => {
        const password = value.trim()
        if (!password) return
        setValue('')
        if (!(await onSave(password))) setValue(password)
    }
    return (
        <div className="px-4 pb-1">
            <Input
                type="password"
                autoComplete="new-password"
                value={value}
                disabled={disabled}
                onChange={event => setValue(event.target.value)}
                onBlur={() => void commit()}
                onKeyDown={event => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void commit()
                }}
                placeholder={hasPassword ? 'Password set' : 'Set a password'}
                aria-label="Password"
                className="h-8"
            />
        </div>
    )
}

function InviteDetail({ invited, disabled, onSave }: { invited: string[]; disabled: boolean; onSave: (invite: string[]) => Promise<boolean> }) {
    const [draft, setDraft] = useState('')

    const add = async () => {
        const entry = draft.trim().toLowerCase().replace(/,$/, '')
        if (!entry) return
        setDraft('')
        if (invited.includes(entry)) return
        if (!(await onSave([...invited, entry]))) setDraft(entry)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' && event.key !== ',') return
        event.preventDefault()
        void add()
    }

    // The last invite stays: a link for invited people needs at least one, and taking it away would
    // leave nobody able to open it. Picking another mode is how it closes.
    const removable = invited.length > 1

    return (
        <div className="flex flex-col gap-2 px-4 pb-1">
            <Input value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={() => void add()} placeholder="Emails or @company.com" aria-label="Invite emails or domains" className="h-8" />
            {invited.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {invited.map(entry => (
                        <span key={entry} className="flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs">
                            <span className="truncate">{inviteLabel(entry)}</span>
                            {removable && (
                                <button
                                    type="button"
                                    aria-label={`Remove ${entry}`}
                                    disabled={disabled}
                                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                    onClick={() => void onSave(invited.filter(other => other !== entry))}
                                >
                                    <XIcon className="size-3" />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}

export function CopyLinkButton({ url, label = 'Copy link', variant = 'outline', size }: { url: string | null; label?: string; variant?: 'outline' | 'ghost'; size?: 'sm' }) {
    const [copied, setCopied] = useState(false)
    const copy = () => {
        if (!url) return
        void navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }
    return (
        <Button variant={variant} size={size} onClick={copy} disabled={!url} className="shrink-0">
            {copied ? <CheckIcon /> : <LinkIcon />}
            {copied ? 'Copied' : label}
        </Button>
    )
}
