'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { requestSandboxReactivationAction } from '@/app/api/_actions/workspace-restore.actions'
import { ExplainerPanel, type ExplainerPoint } from '@/components/dialogs/ExplainerPanel'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const NOTE_ID = 'sandbox-reactivation-note'

const POINT_KEYS = ['archived', 'kept', 'reviewed', 'restored'] as const

export function RequestSandboxReactivationDialog({ open, onOpenChange, onRequested }: { open: boolean; onOpenChange: (open: boolean) => void; onRequested: () => void }) {
    const t = useTranslations('dialogs.sandboxReactivation')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const points: readonly ExplainerPoint[] = POINT_KEYS.map(key => ({ label: t(`points.${key}.label`), description: t(`points.${key}.description`) }))
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | undefined>(undefined)
    const [submitting, setSubmitting] = useState(false)

    const handleOpenChange = (next: boolean) => {
        onOpenChange(next)
        if (!next) {
            setNote('')
            setError(undefined)
        }
    }

    const submit = async () => {
        setSubmitting(true)
        const result = await requestSandboxReactivationAction(note).catch(() => ({ ok: false, error: t('failed') }) as const)
        setSubmitting(false)
        if (!result.ok) return setError(errorText(result))
        onRequested()
        handleOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <SplitDialogContent aside={<ExplainerPanel title={t('asideTitle')} points={points} />}>
                <div className="flex min-h-0 flex-col p-6">
                    <DialogHeader className="mb-4">
                        <DialogTitle>{t('title')}</DialogTitle>
                        <p className="text-sm text-muted-foreground">{t('description')}</p>
                    </DialogHeader>
                    <div className="-mx-1 -mt-1 min-h-0 flex-1 overflow-y-auto px-1 pt-1">
                        <Field label={t('noteLabel')} htmlFor={NOTE_ID} error={error} helperText={t('noteHint')}>
                            <Textarea id={NOTE_ID} value={note} onChange={event => setNote(event.target.value)} rows={6} maxLength={1000} autoFocus />
                        </Field>
                    </div>
                    <DialogFooter className="-mx-6 mt-auto -mb-6 border-t bg-muted/50 px-6 py-4">
                        <Button variant="outline" onClick={() => handleOpenChange(false)}>
                            {tCommon('cancel')}
                        </Button>
                        <Button onClick={submit} disabled={!note.trim() || submitting}>
                            {t('submit')}
                        </Button>
                    </DialogFooter>
                </div>
            </SplitDialogContent>
        </Dialog>
    )
}
