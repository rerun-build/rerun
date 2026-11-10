'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { Card, CardContent, CardHeader, CardTitle } from '@rerun/ui/primitives'
import { Reorder } from 'motion/react'
import * as React from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { GripVerticalIcon, Trash2 } from '@/lib/icons'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Input } from '@/components/ui/input'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { cn } from '@/lib/utils'
import { useTemplateAuthoring } from './actions-context'
import { GenerateAltTextButton } from './GenerateAltTextButton'

type GalleryImage = { url: string; alt: string }

export function TemplateMediaSection() {
    const t = useTranslations('templates.authoring.media')
    const { control } = useFormContext<TemplateFormValues>()
    const { scope } = useTemplateAuthoring()

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <Controller control={control} name="gallery" render={({ field }) => <Gallery value={field.value} onChange={field.onChange} />} />

                <div className={cn('grid gap-4', scope === 'admin' && 'sm:grid-cols-2')}>
                    <Controller
                        control={control}
                        name="videoUrl"
                        render={({ field }) => (
                            <Input label={t('videoUrl')} optional placeholder={t('videoPlaceholder')} {...field} />
                        )}
                    />
                    {scope === 'admin' && (
                        <Controller
                            control={control}
                            name="ogImageUrl"
                            render={({ field }) => (
                                <Input
                                    label={t('ogImage')}
                                    optional
                                    placeholder={t('ogImagePlaceholder')}
                                    helperText={t('ogImageHelp')}
                                    {...field}
                                />
                            )}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

// The gallery is ordered and the first image is the cover, so reordering is a real
// editorial action rather than a nicety.
function Gallery({ value, onChange }: { value: GalleryImage[]; onChange: (next: GalleryImage[]) => void }) {
    const t = useTranslations('templates.authoring.media')
    const errorText = useErrorText()
    const { actions } = useTemplateAuthoring()
    const [uploading, setUploading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    async function handleFiles(files: File[]) {
        setError(null)
        setUploading(true)
        try {
            const uploaded: GalleryImage[] = []
            for (const file of files) {
                const formData = new FormData()
                formData.append('file', file)
                const result = await actions.uploadImage(formData, 'gallery')
                if (!result.ok) {
                    setError(errorText(result))
                    break
                }
                uploaded.push({ url: result.url, alt: '' })
            }
            if (uploaded.length) onChange([...value, ...uploaded])
        } finally {
            setUploading(false)
        }
    }

    return (
        <Field
            label={t('gallery')}
            helperText={error ?? t('galleryHelp')}
            error={error ?? undefined}
        >
            <div className="flex flex-col gap-3">
                {value.length > 0 && (
                    <Reorder.Group axis="y" values={value} onReorder={onChange} className="flex flex-col gap-2">
                        {value.map((image, index) => (
                            <Reorder.Item
                                key={image.url}
                                value={image}
                                className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-background p-2"
                            >
                                <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={image.url} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                                <div className="flex-1">
                                    <Input
                                        placeholder={index === 0 ? t('altCover') : t('alt')}
                                        value={image.alt}
                                        onChange={e => onChange(value.map((img, i) => (i === index ? { ...img, alt: e.target.value } : img)))}
                                    />
                                </div>
                                <GenerateAltTextButton
                                    imageUrl={image.url}
                                    isCover={index === 0}
                                    onGenerated={alt => onChange(value.map((img, i) => (i === index ? { ...img, alt } : img)))}
                                />
                                {index === 0 && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t('cover')}</span>}
                                <button
                                    type="button"
                                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                                    title={t('remove')}
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </Reorder.Item>
                        ))}
                    </Reorder.Group>
                )}

                <FileDropzone onFiles={handleFiles} accept="image/*" multiple disabled={uploading} overlayLabel={t('dropOverlay')}>
                    {({ inputId }) => (
                        <label
                            htmlFor={inputId}
                            className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-foreground/20 py-6 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                        >
                            {uploading ? t('uploading') : t('drop')}
                        </label>
                    )}
                </FileDropzone>
            </div>
        </Field>
    )
}
