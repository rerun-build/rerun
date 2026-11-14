'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PencilIcon } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useBoxViewer, useCanManageSpace } from '@/hooks/useBoxAccess'
import { BOX_NAME_MAX, type SpacePublic } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

type FormValues = { name: string }

// A Box is a rectangle on the board and a name, nothing else: renaming it is the whole of its
// settings, so it is a dialog rather than a panel.
export function RenameBoxDialog({ space, open, onOpenChange }: { space: SpacePublic | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.renameBox')
    const tCommon = useTranslations('common')
    const schema = useMemo(() => z.object({ name: z.string().trim().min(1, t('nameRequired')).max(BOX_NAME_MAX, t('nameTooLong', { max: BOX_NAME_MAX })) }), [t])
    const renameSpace = useBoardStore(s => s.renameSpace)
    const viewer = useBoxViewer()
    const canManage = useCanManageSpace(space?.id)
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: space?.name ?? '' } })

    // The name catches up by realtime, so the field is rearmed on each opening rather than tracked.
    useEffect(() => {
        if (open) form.reset({ name: space?.name ?? '' })
    }, [open, space?.name, form])

    const onSubmit = form.handleSubmit(values => {
        if (space) renameSpace(space.id, values.name.trim(), viewer)
        onOpenChange(false)
    })

    return (
        <Dialog open={open && canManage} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <Form {...form}>
                    <form onSubmit={onSubmit} className="flex flex-col gap-4">
                        <DialogHeaderBar icon={PencilIcon} title={t('title')} description={t('description')} />

                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input label={t('nameLabel')} required autoFocus placeholder={t('placeholder')} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                {tCommon('cancel')}
                            </Button>
                            <Button type="submit" disabled={!form.watch('name').trim()}>
                                {t('submit')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
