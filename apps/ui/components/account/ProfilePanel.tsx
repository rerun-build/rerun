'use client'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PROFILE_NAME_MAX } from '@/lib/auth/user-profile'
import { ImageIcon, Loader2Icon, Trash2, Upload, UserRoundIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { CardAvatar } from '@rerun/ui/chat'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export type ProfilePanelProps = {
    name: string
    avatarUrl: string | null
    // What the initials are drawn from while the account has no name: its email. An account born
    // from a phone number has neither, and a number makes no initials.
    fallbackLabel: string | null
    uploadAvatar: (file: File) => Promise<void>
    removeAvatar: () => Promise<void>
    saveName: (name: string) => Promise<void>
}

export function ProfilePanel({ name, avatarUrl, fallbackLabel, uploadAvatar, removeAvatar, saveName }: ProfilePanelProps) {
    const t = useTranslations('account.profile')
    const errorMessage = (error: unknown) => (error instanceof Error ? error.message : t('failed'))
    const [draft, setDraft] = useState(name)
    const [savedName, setSavedName] = useState(name)
    const [saving, setSaving] = useState(false)
    const [photoBusy, setPhotoBusy] = useState(false)
    const [photoMenuOpen, setPhotoMenuOpen] = useState(false)

    if (savedName !== name) {
        setSavedName(name)
        setDraft(name)
    }

    const trimmed = draft.trim()
    const dirty = trimmed !== name.trim()

    const changePhoto = async (change: () => Promise<void>) => {
        setPhotoBusy(true)
        try {
            await change()
        } catch (error) {
            toast.error(errorMessage(error))
        } finally {
            setPhotoBusy(false)
        }
    }

    const handleFiles = (files: File[]) => {
        const file = files[0]
        if (!file) return
        if (!file.type.startsWith('image/')) {
            toast.error(t('notAnImage'))
            return
        }
        void changePhoto(() => uploadAvatar(file))
    }

    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!dirty || !trimmed) return
        setSaving(true)
        try {
            await saveName(trimmed)
            toast.success(t('nameUpdated'))
        } catch (error) {
            toast.error(errorMessage(error))
        } finally {
            setSaving(false)
        }
    }

    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
                <Field label={t('photo')} helperText={t('photoHelp')}>
                    <FileDropzone accept="image/*" onFiles={handleFiles} disabled={photoBusy} overlayLabel={t('dropPhoto')} className="w-fit rounded-full">
                        {({ inputId, dragOver }) => (
                            <Popover open={photoMenuOpen} onOpenChange={setPhotoMenuOpen}>
                                <PopoverTrigger asChild>
                                    <button type="button" aria-label={t('changePhoto')} className="group relative block size-20 rounded-full">
                                        {avatarUrl || name || fallbackLabel ? (
                                            <CardAvatar src={avatarUrl} name={name || fallbackLabel || ''} className="size-20 text-2xl" />
                                        ) : (
                                            <span className="flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                <UserRoundIcon className="size-8" />
                                            </span>
                                        )}
                                        <span
                                            className={cn(
                                                'absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                                                (dragOver || photoMenuOpen || photoBusy) && 'opacity-100',
                                            )}
                                        >
                                            {photoBusy ? <Loader2Icon className="size-5 animate-spin text-white" /> : <ImageIcon className="size-5 text-white" />}
                                        </span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" sideOffset={8} className="w-44 gap-0.5 p-1">
                                    <label htmlFor={inputId} onClick={() => setPhotoMenuOpen(false)} className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                        <Upload className="size-4" />
                                        {t('uploadPhoto')}
                                    </label>
                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPhotoMenuOpen(false)
                                                void changePhoto(removeAvatar)
                                            }}
                                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                        >
                                            <Trash2 className="size-4" />
                                            {t('removePhoto')}
                                        </button>
                                    )}
                                </PopoverContent>
                            </Popover>
                        )}
                    </FileDropzone>
                </Field>

                <Input label={t('name')} placeholder={t('namePlaceholder')} autoComplete="name" maxLength={PROFILE_NAME_MAX} value={draft} onChange={event => setDraft(event.target.value)} />
            </div>

            <div className="flex justify-end border-t px-4 py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <Button type="submit" disabled={!dirty || !trimmed} loading={saving}>
                    {t('save')}
                </Button>
            </div>
        </form>
    )
}
