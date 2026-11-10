'use client'

import * as React from 'react'

import { cn } from '../cn'
import { FileDropzone, Popover, PopoverContent, PopoverTrigger } from '../forms'
import { ImageIcon, Trash2, Upload } from '../icons'
import { Badge } from '../primitives'
import { ExpertAvatar } from './ExpertAvatar'
import { ExpertBannerPicker } from './ExpertBannerPicker'
import { badgeTone } from './options'
import type { ExpertBadge } from './options'
import type { ExpertUpload } from './types'
import { useKitTranslations } from '../locale'
import type { KitTranslator } from '../kit-translator'

interface ExpertImageFieldsProps {
    initials: string
    avatarUrl: string
    bannerUrl: string
    bannerOptions: readonly string[]
    uploadAvatar: ExpertUpload
    uploadBanner: ExpertUpload
    onAvatarChange: (url: string) => void
    onBannerChange: (url: string) => void
    badge?: ExpertBadge
}

export function ExpertImageFields({
    initials,
    avatarUrl,
    bannerUrl,
    bannerOptions,
    uploadAvatar,
    uploadBanner,
    onAvatarChange,
    onBannerChange,
    badge,
}: ExpertImageFieldsProps) {
    const t = useKitTranslations()
    const [bannerOpen, setBannerOpen] = React.useState(false)
    const [avatarOpen, setAvatarOpen] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    const bannerUpload = useImageUpload(uploadBanner, onBannerChange, setError, t)
    const avatarUpload = useImageUpload(uploadAvatar, onAvatarChange, setError, t)

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('experts.images.title')}</span>
            <div className="overflow-hidden rounded-xl border bg-card">
                <FileDropzone accept="image/*" onFiles={bannerUpload.handleFiles} disabled={bannerUpload.uploading} overlayLabel={t('experts.images.dropBanner')}>
                    {({ dragOver }) => (
                        <div className="group relative h-44 bg-foreground/5">
                            {bannerUrl ? <img src={bannerUrl} alt="" className="absolute inset-0 size-full object-cover" /> : null}
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-card to-transparent" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />
                            {badge && (
                                <div className="absolute top-3 right-3">
                                    <Badge tone={badgeTone(badge)} size="sm">
                                        {badge}
                                    </Badge>
                                </div>
                            )}
                            <div className={cn('absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100', (dragOver || bannerOpen) && 'opacity-100')}>
                                <Popover modal open={bannerOpen} onOpenChange={setBannerOpen}>
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20"
                                        >
                                            <ImageIcon className="size-3.5" />
                                            {bannerUpload.uploading ? t('experts.images.uploading') : t('experts.images.changeBanner')}
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent side="right" align="center" sideOffset={8} className="w-[calc(100vw-2rem)] sm:w-[22rem]">
                                        <ExpertBannerPicker options={bannerOptions} value={bannerUrl} onChange={onBannerChange} onDone={() => setBannerOpen(false)} upload={uploadBanner} />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    )}
                </FileDropzone>

                <div className="relative -mt-10 px-6 pb-5">
                    <FileDropzone accept="image/*" onFiles={avatarUpload.handleFiles} disabled={avatarUpload.uploading} overlayLabel={t('experts.images.dropPhoto')} className="w-fit rounded-2xl">
                        {({ inputId, dragOver }) => (
                            <Popover open={avatarOpen} onOpenChange={setAvatarOpen}>
                                <PopoverTrigger asChild>
                                    <button type="button" className="group relative block size-20 rounded-2xl">
                                        <ExpertAvatar initials={initials} src={avatarUrl || null} className="size-20 text-2xl ring-4 ring-card" />
                                        <div className={cn('absolute inset-0 flex items-center justify-center rounded-2xl bg-black/55 opacity-0 transition-opacity group-hover:opacity-100', (dragOver || avatarOpen || avatarUpload.uploading) && 'opacity-100')}>
                                            {avatarUpload.uploading ? <span className="text-[11px] font-medium text-white">…</span> : <ImageIcon className="size-5 text-white" />}
                                        </div>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" sideOffset={8} className="w-44 gap-0.5 p-1">
                                    <label
                                        htmlFor={inputId}
                                        onClick={() => setAvatarOpen(false)}
                                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                        <Upload className="size-4" />
                                        {t('experts.images.uploadPhoto')}
                                    </label>
                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onAvatarChange('')
                                                setAvatarOpen(false)
                                            }}
                                            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                        >
                                            <Trash2 className="size-4" />
                                            {t('experts.images.remove')}
                                        </button>
                                    )}
                                </PopoverContent>
                            </Popover>
                        )}
                    </FileDropzone>
                </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}

function useImageUpload(upload: ExpertUpload, onChange: (url: string) => void, setError: (error: string | null) => void, t: KitTranslator) {
    const [uploading, setUploading] = React.useState(false)

    const handleFiles = async (files: File[]) => {
        const file = files[0]
        if (!file) return
        if (!file.type.startsWith('image/')) {
            setError(t('experts.images.notAnImage'))
            return
        }

        setError(null)
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const result = await upload(formData)
            if (result.ok) {
                onChange(result.url)
            } else {
                setError(result.error)
            }
        } finally {
            setUploading(false)
        }
    }

    return { uploading, handleFiles }
}
