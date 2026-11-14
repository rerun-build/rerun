'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PencilIcon } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxAccessCopy } from '@/components/dialogs/access-person'
import { useBoardStore } from '@/stores/board.store'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const AGENT_NAME_MAX = 60

type FormValues = { name: string }

export function RenameAgentDialog({ agent, open, onOpenChange }: { agent: { id: string; name: string } | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.renameAgent')
    const tCommon = useTranslations('common')
    const { manageReason } = useBoxAccessCopy()
    const schema = useMemo(() => z.object({ name: z.string().trim().min(1, t('nameRequired')).max(AGENT_NAME_MAX, t('nameTooLong', { max: AGENT_NAME_MAX })) }), [t])
    const renameAgent = useBoardStore(s => s.renameAgent)
    const canManage = useCanManageAgent(agent?.id)
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: agent?.name ?? '' } })

    useEffect(() => {
        if (open) form.reset({ name: agent?.name ?? '' })
    }, [open, agent?.name, form])

    const onSubmit = form.handleSubmit(values => {
        const name = values.name.trim()
        if (agent && canManage && name !== agent.name) renameAgent(agent.id, name)
        onOpenChange(false)
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
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
                                        <Input label={t('nameLabel')} required autoFocus disabled={!canManage} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                {tCommon('cancel')}
                            </Button>
                            <TooltipDisabledReason reason={canManage ? undefined : manageReason}>
                                <Button type="submit" disabled={!canManage || !form.watch('name').trim()}>
                                    {t('submit')}
                                </Button>
                            </TooltipDisabledReason>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
