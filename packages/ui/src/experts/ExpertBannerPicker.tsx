'use client'

import * as React from 'react'

import { cn } from '../cn'
import { FileDropzone } from '../forms'
import { ImageIcon } from '../icons'
import type { ExpertUpload } from './types'
import { useKitTranslations } from '../locale'

interface ExpertBannerPickerProps {
    options: readonly string[]
    value: string
    onChange: (url: string) => void
    onDone: () => void
    upload: ExpertUpload
}

export function ExpertBannerPicker({ options, value, onChange, onDone, upload }: ExpertBannerPickerProps) {
    const t = useKitTranslations()
    const [uploading, setUploading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

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
                onDone()
            } else {
                setError(result.error)
            }
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-0.5">
                <FileDropzone accept="image/*" onFiles={handleFiles} disabled={uploading} overlayLabel={t('experts.images.drop')} className="rounded-md">
                    {({ inputId, dragOver }) => (
                        <label
                            htmlFor={inputId}
                            className={cn(
                                'flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input bg-background text-center text-muted-foreground transition-colors hover:border-primary hover:text-foreground',
                                dragOver && 'border-primary',
                                uploading && 'pointer-events-none opacity-60',
                            )}
                        >
                            <ImageIcon className="size-4" />
                            <span className="text-[10px] leading-tight">{uploading ? t('experts.images.uploading') : t('experts.images.upload')}</span>
                        </label>
                    )}
                </FileDropzone>

                {options.map(url => (
                    <button
                        key={url}
                        type="button"
                        onClick={() => {
                            onChange(url)
                            onDone()
                        }}
                        className={cn(
                            'aspect-[3/2] overflow-hidden rounded-md border transition-colors',
                            value === url ? 'border-primary ring-2 ring-primary' : 'border-input hover:border-primary',
                        )}
                    >
                        <img src={url} alt="" className="size-full object-cover" />
                    </button>
                ))}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
