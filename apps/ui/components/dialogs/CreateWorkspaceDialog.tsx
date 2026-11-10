'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { inviteToWorkspaceAction } from '@/app/api/_actions/members.actions'
import { createWorkspaceAction } from '@/app/api/_actions/workspace.actions'
import { CreateWorkspacePreview } from '@/components/dialogs/CreateWorkspacePreview'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ScrollFade } from '@rerun/ui/primitives'
import { StepTransition, StepperBar, useStepper } from '@rerun/ui/steps'
import { BLOB_ILLUSTRATIONS, getBlobByFile, randomBlob } from '@/lib/blobs/catalog'
import { cn } from '@/lib/utils'
import { abortWorkspaceSwitch, beginWorkspaceSwitch, enterActiveWorkspace } from '@/lib/workspace/workspace-switch'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckIcon, Loader2Icon, XIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

type Step = 'Name' | 'Icon' | 'Team'

const STEPS: readonly Step[] = BLOB_ILLUSTRATIONS.length > 0 ? ['Name', 'Icon', 'Team'] : ['Name', 'Team']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormValues = { name: string; iconFile: string; members: string[]; memberDraft: string }

const defaultValues: FormValues = { name: '', iconFile: '', members: [], memberDraft: '' }

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.createWorkspace')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const { index: step, direction, goForward, back, reset: resetStepper } = useStepper(STEPS.length)
    const current = STEPS[step]
    // Already the active workspace server-side: the dialog is only still open to report the
    // invitations that failed, and closing it can only lead into the new workspace.
    const [created, setCreated] = useState(false)

    const schema = useMemo(() => z.object({ name: z.string().trim().min(1, t('nameRequired')), iconFile: z.string(), members: z.array(z.string()), memberDraft: z.string() }), [t])
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues })
    const {
        formState: { isSubmitting },
    } = form

    const name = form.watch('name')
    const iconFile = form.watch('iconFile')
    const members = form.watch('members')
    const memberDraft = form.watch('memberDraft')

    useEffect(() => {
        const blob = open && !iconFile ? randomBlob() : undefined
        if (blob) form.setValue('iconFile', blob.file)
    }, [open, iconFile, form])

    const handleOpenChange = (next: boolean) => {
        if (!next && created) return enterActiveWorkspace()
        onOpenChange(next)
        if (!next) {
            resetStepper()
            form.reset(defaultValues)
        }
    }

    const addMember = () => {
        const email = memberDraft.trim().toLowerCase()
        if (!EMAIL_RE.test(email) || members.includes(email)) return
        form.setValue('members', [...members, email])
        form.setValue('memberDraft', '')
    }

    const removeMember = (email: string) => {
        form.setValue(
            'members',
            members.filter(m => m !== email),
        )
    }

    const onSubmit = form.handleSubmit(async ({ name, iconFile, members }) => {
        if (created) return enterActiveWorkspace()
        const iconUrl = getBlobByFile(iconFile)?.url
        beginWorkspaceSwitch({ loader: false })
        const result = await createWorkspaceAction(name, iconUrl)
        if (!result.ok) {
            abortWorkspaceSwitch()
            form.setError('root', { message: errorText(result) })
            return
        }
        setCreated(true)

        // Sent before leaving, because they target the active workspace, and reported here, because
        // a toast would not survive the reload.
        if (members.length > 0) {
            const outcomes = await Promise.all(members.map(email => inviteToWorkspaceAction(email)))
            const failed = outcomes.filter(o => !o.ok).length
            if (failed > 0) {
                form.setError('root', { message: t('invitesFailed', { count: failed }) })
                return
            }
        }

        enterActiveWorkspace()
    })

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <SplitDialogContent aside={<CreateWorkspacePreview name={name} iconFile={iconFile} members={members} />}>
                <Form {...form}>
                    <form onSubmit={onSubmit} className="flex min-h-0 flex-col p-6">
                        <StepperBar count={STEPS.length} current={step} className="mb-6" />

                        <DialogHeader className="mb-4">
                            <StepTransition stepKey={step} direction={direction} variant="header" className="grid gap-1">
                                <DialogTitle>
                                    {current === 'Name' && t('steps.name.title')}
                                    {current === 'Icon' && t('steps.icon.title')}
                                    {current === 'Team' && t('steps.team.title')}
                                </DialogTitle>
                                <p className="text-sm text-muted-foreground">
                                    {current === 'Name' && t('steps.name.description')}
                                    {current === 'Icon' && t('steps.icon.description')}
                                    {current === 'Team' && t('steps.team.description')}
                                </p>
                            </StepTransition>
                        </DialogHeader>

                        <ScrollFade className="-mx-1 -mt-1 min-h-0 flex-1 px-1 pb-6 pt-1">
                            <StepTransition stepKey={step} direction={direction}>
                                {current === 'Name' && (
                                    <div className="space-y-4">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <Input label={t('name')} required placeholder={t('namePlaceholder')} {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}

                                {current === 'Icon' && (
                                    <div className="grid grid-cols-5 gap-2">
                                        {BLOB_ILLUSTRATIONS.map(blob => (
                                            <button
                                                key={blob.file}
                                                type="button"
                                                onClick={() => form.setValue('iconFile', blob.file)}
                                                className={cn(
                                                    'relative aspect-square overflow-hidden rounded-lg border transition-colors',
                                                    iconFile === blob.file ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40',
                                                )}
                                            >
                                                <img src={blob.url} alt={blob.desc} className="size-full object-cover" />
                                                {iconFile === blob.file && (
                                                    <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-foreground">
                                                        <CheckIcon className="size-2.5 text-background" />
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {current === 'Team' && (
                                    <div className="space-y-4">
                                        <div className="flex items-end gap-2">
                                            <div className="flex-1">
                                                <Input
                                                    label={t('email')}
                                                    type="email"
                                                    placeholder={t('emailPlaceholder')}
                                                    helperText={t('emailHint')}
                                                    {...form.register('memberDraft')}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            addMember()
                                                        }
                                                    }}
                                                />
                                            </div>
                                            <Button type="button" variant="outline" onClick={addMember} disabled={!EMAIL_RE.test(memberDraft.trim().toLowerCase())}>
                                                {t('add')}
                                            </Button>
                                        </div>

                                        {members.length > 0 && (
                                            <ul className="flex flex-col gap-2">
                                                {members.map(email => (
                                                    <li key={email} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                                                        <span className="min-w-0 flex-1 truncate text-sm">{email}</span>
                                                        <button type="button" onClick={() => removeMember(email)} aria-label={t('removeMember', { email })} className="text-muted-foreground hover:text-foreground">
                                                            <XIcon className="size-4" />
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </StepTransition>

                            {form.formState.errors.root && <p className="mt-4 text-sm text-destructive">{form.formState.errors.root.message}</p>}
                        </ScrollFade>

                        <DialogFooter className="mt-auto -mx-6 -mb-6 border-t bg-muted/50 px-6 py-4">
                            {created ? (
                                <Button type="button" onClick={enterActiveWorkspace}>
                                    {t('open')}
                                </Button>
                            ) : step > 0 ? (
                                <Button type="button" variant="outline" onClick={back}>
                                    {t('back')}
                                </Button>
                            ) : (
                                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                    {tCommon('cancel')}
                                </Button>
                            )}
                            {!created && current === 'Name' && (
                                <Button type="button" onClick={goForward} disabled={!name.trim()}>
                                    {t('continue')}
                                </Button>
                            )}
                            {!created && current === 'Icon' && (
                                <Button type="button" onClick={goForward}>
                                    {t('continue')}
                                </Button>
                            )}
                            {!created && current === 'Team' && (
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting && <Loader2Icon className="animate-spin" />}
                                    {isSubmitting ? t('creating') : t('create')}
                                </Button>
                            )}
                        </DialogFooter>
                    </form>
                </Form>
            </SplitDialogContent>
        </Dialog>
    )
}
