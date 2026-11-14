'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { useErrorText } from '@/hooks/useErrorText'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { ActionResult } from '@/app/api/_actions/space.actions'
import { updatePublishPolicyAction } from '@/app/api/_actions/publish.actions'
import { updateWorkspaceAction } from '@/app/api/_actions/workspace.actions'
import { useLanguagePacksEnabled, usePublishedAccessEnabled } from '@/components/layout/FeatureFlagsProvider'
import { PublishPolicyField, usePublishPolicyDraft } from '@/components/published/PublishPolicyField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { FileDropzone } from '@/components/ui/file-dropzone'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { BLOB_ILLUSTRATIONS, getBlobByFile } from '@/lib/blobs/catalog'
import { CheckIcon, GlobeIcon, Loader2Icon, UploadIcon, Settings2Icon } from '@/lib/icons'
import { WORKSPACE_NAME_MAX } from '@/lib/naming/workspace-name'
import { cn } from '@/lib/utils'
import { LOGO_ACCEPT, logoLinkImageUrl, NO_LOGO_FOUND, readLogoLink, type LogoLink } from '@/lib/workspace/logo-input'
import { useIsWorkspaceAdmin, useSession } from '@/supabase/session/SessionProvider'
import { DEFAULT_LOCALE, isStableLocale, localeNativeName, stableLocales, type Locale } from '@rerun/i18n'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

type FormValues = { name: string }

// `current` keeps the icon the workspace already has, which can be a company favicon rather than
// one of the illustrations. Sending no logo field for it is what stops a rename from replacing it.
type LogoDraft = { kind: 'current' } | { kind: 'blob'; file: string } | { kind: 'link'; link: LogoLink } | { kind: 'upload'; file: File; previewUrl: string }

const VISIBLE_ILLUSTRATIONS = 10

export function WorkspaceSettingsDialog({ open, onOpenChange, fallbackIconUrl }: { open: boolean; onOpenChange: (open: boolean) => void; fallbackIconUrl?: string }) {
    const t = useTranslations('workspace.settings')
    const { workspace, refreshWorkspace } = useSession()
    const isAdmin = useIsWorkspaceAdmin()
    const publishedAccess = usePublishedAccessEnabled()
    const languagePacks = useLanguagePacksEnabled()
    const policy = usePublishPolicyDraft(open && publishedAccess && !!workspace && !workspace.is_sandbox)
    if (!workspace) return null

    const save = async (formData: FormData): Promise<ActionResult> => {
        const result = await updateWorkspaceAction(formData)
        if (!result.ok) return result
        if (policy.changed && policy.draft) {
            const saved = await updatePublishPolicyAction(policy.draft)
            if (!saved.ok) return saved
        }
        await refreshWorkspace()
        onOpenChange(false)
        return result
    }

    const policyField = policy.settings ? <PublishPolicyField value={policy.draft} onChange={policy.setDraft} publicLinks={policy.settings.publicLinks} workspaceName={workspace.name || t('fallbackName')} /> : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
                {open && <WorkspaceSettingsForm workspace={workspace} fallbackIconUrl={fallbackIconUrl} onSave={save} onCancel={() => onOpenChange(false)} extra={policyField} showLanguage={languagePacks} disabledReason={isAdmin ? undefined : t('adminOnly')} />}
            </DialogContent>
        </Dialog>
    )
}

export function WorkspaceSettingsForm({
    workspace,
    fallbackIconUrl,
    onSave,
    onCancel,
    extra,
    showLanguage = false,
    disabledReason,
}: {
    workspace: { name: string | null; icon_url: string | null; locale?: string }
    fallbackIconUrl?: string
    onSave: (formData: FormData) => Promise<ActionResult>
    onCancel: () => void
    extra?: ReactNode
    showLanguage?: boolean
    disabledReason?: string
}) {
    const t = useTranslations('workspace.settings')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const schema = useMemo(() => z.object({ name: z.string().trim().min(1, t('nameRequired')).max(WORKSPACE_NAME_MAX, t('nameTooLong', { max: WORKSPACE_NAME_MAX })) }), [t])
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: workspace.name ?? '' } })
    const {
        formState: { isSubmitting },
    } = form
    const name = form.watch('name')

    const [logo, setLogo] = useState<LogoDraft>({ kind: 'current' })
    const [locale, setLocale] = useState<Locale>(isStableLocale(workspace.locale) ? workspace.locale : DEFAULT_LOCALE)
    const [linkInput, setLinkInput] = useState('')
    const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
    const [brokenPreviewSrc, setBrokenPreviewSrc] = useState<string | null>(null)

    const uploadPreviewUrl = logo.kind === 'upload' ? logo.previewUrl : null
    useEffect(() => {
        if (!uploadPreviewUrl) return
        return () => URL.revokeObjectURL(uploadPreviewUrl)
    }, [uploadPreviewUrl])

    const currentSrc = workspace.icon_url ?? ''
    const logoSrc = logoDraftSrc(logo, currentSrc)
    const linkBroken = logo.kind === 'link' && brokenSrc === logoSrc
    const previewSrc = linkBroken ? currentSrc : logoSrc
    const shownPreviewSrc = previewSrc && brokenPreviewSrc !== previewSrc ? previewSrc : fallbackIconUrl
    const selectedBlobUrl = logo.kind === 'blob' ? getBlobByFile(logo.file)?.url : logo.kind === 'current' ? currentSrc : undefined

    const changeLink = (value: string) => {
        setLinkInput(value)
        const link = readLogoLink(value)
        if (link) setLogo({ kind: 'link', link })
        else if (logo.kind === 'link') setLogo({ kind: 'current' })
    }

    const upload = (file: File) => {
        setLinkInput('')
        setLogo({ kind: 'upload', file, previewUrl: URL.createObjectURL(file) })
    }

    const pickBlob = (file: string) => {
        setLinkInput('')
        setLogo({ kind: 'blob', file })
    }

    const onSubmit = form.handleSubmit(async values => {
        if (disabledReason) return
        const formData = new FormData()
        formData.set('name', values.name)
        if (logo.kind === 'blob') formData.set('iconFile', logo.file)
        if (logo.kind === 'link') formData.set('logoLink', linkInput)
        if (logo.kind === 'upload') formData.set('logoFile', logo.file)
        if (showLanguage) formData.set('locale', locale)

        const result = await onSave(formData)
        if (result.ok) return
        // The favicon service answers an unknown domain with a placeholder globe the browser shows
        // happily, so only the server can tell the link found nothing.
        if (logo.kind === 'link' && result.error === NO_LOGO_FOUND) setBrokenSrc(logoSrc)
        else form.setError('root', { message: errorText(result) })
    })

    return (
        <Form {...form}>
            <form onSubmit={onSubmit} className="flex max-h-full min-h-0 flex-1 flex-col">
                <DialogHeaderBar icon={Settings2Icon} title={t('title')} description={t('description')} />

                <ScrollFade className="min-h-0 flex-1 p-4">
                    <div className="space-y-6">
                        <div className="flex items-end gap-4">
                            <FileDropzone onFiles={files => upload(files[0])} accept={LOGO_ACCEPT} overlayLabel="" className="shrink-0">
                                {({ inputId }) => (
                                    <label htmlFor={inputId} aria-label={t('uploadLogo')} className="group relative block size-16 cursor-pointer">
                                        {shownPreviewSrc ? <img src={shownPreviewSrc} alt="" onError={() => setBrokenPreviewSrc(previewSrc)} className="size-full rounded-2xl bg-muted object-cover" /> : <span className="block size-full rounded-2xl bg-muted" />}
                                        <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border bg-background shadow-sm transition-colors group-hover:bg-muted">
                                            <UploadIcon className="size-3.5" />
                                        </span>
                                    </label>
                                )}
                            </FileDropzone>
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="min-w-0 flex-1">
                                        <FormControl>
                                            <Input label={t('name')} required placeholder={t('namePlaceholder')} {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Field label={t('logoLink')} error={linkBroken ? t('noLogoFound') : undefined}>
                            <div className="relative">
                                <span className="pointer-events-none absolute top-1/2 left-2.5 flex size-5 -translate-y-1/2 items-center justify-center overflow-hidden rounded">
                                    {logo.kind === 'link' && !linkBroken ? <img src={logoSrc} alt="" className="size-full object-contain" onError={() => setBrokenSrc(logoSrc)} /> : <GlobeIcon className="size-4 text-muted-foreground" />}
                                </span>
                                <Input className="pl-10" placeholder="acme.com" inputMode="url" autoComplete="url" value={linkInput} onChange={e => changeLink(e.target.value)} />
                            </div>
                        </Field>

                        {BLOB_ILLUSTRATIONS.length > 0 && (
                            <Field label={t('pickIllustration')}>
                                <IllustrationGrid selectedUrl={selectedBlobUrl} onPick={pickBlob} />
                            </Field>
                        )}

                        {showLanguage && <CoworkersLanguageField value={locale} onChange={setLocale} />}

                        {extra}

                        {form.formState.errors.root && <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
                    </div>
                </ScrollFade>

                <DialogFooter className="m-0 shrink-0">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        {tCommon('cancel')}
                    </Button>
                    <TooltipDisabledReason reason={disabledReason}>
                        <Button type="submit" disabled={isSubmitting || !name.trim() || !!disabledReason}>
                            {isSubmitting && <Loader2Icon className="animate-spin" />}
                            {isSubmitting ? tCommon('saving') : tCommon('save')}
                        </Button>
                    </TooltipDisabledReason>
                </DialogFooter>
            </form>
        </Form>
    )
}

function CoworkersLanguageField({ value, onChange }: { value: Locale; onChange: (locale: Locale) => void }) {
    const t = useTranslations('workspace.settings')
    return (
        <Field label={t('coworkersLanguage')} htmlFor="workspace-locale" helperText={t('coworkersLanguageHint')}>
            <Select value={value} onValueChange={next => onChange(next as Locale)}>
                <SelectTrigger id="workspace-locale" className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                    {stableLocales().map(locale => (
                        <SelectItem key={locale} value={locale} lang={locale}>
                            {localeNativeName(locale)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    )
}

function logoDraftSrc(logo: LogoDraft, currentSrc: string): string {
    switch (logo.kind) {
        case 'current':
            return currentSrc
        case 'blob':
            return getBlobByFile(logo.file)?.url ?? currentSrc
        case 'link':
            return logoLinkImageUrl(logo.link)
        case 'upload':
            return logo.previewUrl
    }
}

function IllustrationGrid({ selectedUrl, onPick }: { selectedUrl: string | undefined; onPick: (file: string) => void }) {
    const t = useTranslations('workspace.settings')
    const [expanded, setExpanded] = useState(false)
    const blobs = expanded ? BLOB_ILLUSTRATIONS : BLOB_ILLUSTRATIONS.slice(0, VISIBLE_ILLUSTRATIONS)

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                {blobs.map(blob => {
                    const selected = blob.url === selectedUrl
                    return (
                        <button key={blob.file} type="button" onClick={() => onPick(blob.file)} aria-pressed={selected} className={cn('relative aspect-square overflow-hidden rounded-lg border transition-colors', selected ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40')}>
                            <img src={blob.url} alt={blob.desc} className="size-full object-cover" />
                            {selected && (
                                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-foreground">
                                    <CheckIcon className="size-2.5 text-background" />
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setExpanded(value => !value)}>
                {expanded ? t('showLess') : t('showAll', { count: BLOB_ILLUSTRATIONS.length })}
            </Button>
        </div>
    )
}
