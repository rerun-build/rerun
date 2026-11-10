'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createImportKeyAction } from '@/app/api/_actions/api-keys.actions'
import { CopyBlock } from '@/components/dialogs/CopyBlock'
import { CopyLine } from '@/components/dialogs/CopyLine'
import { ImportSourcePicker } from '@/components/dialogs/ImportSourcePicker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { importSource, type ImportSourceId } from '@/lib/agent-import/sources'
import { track } from '@rerun/analytics/client'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

type Prepared = { source: ImportSourceId; connectorUrl: string; prompt: string }

function PreparedSkeleton() {
    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
            </div>
            <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-40 w-full" />
            </div>
        </div>
    )
}

// Each source pick mints its own import key: one key per attempt, so a prompt pasted in the wrong
// agent never shares a coworker with the right one. Closing the dialog drops the key from memory;
// it still expires on its own a day later.
export function ImportAgentDialog({ open, onOpenChange, spaceId = null }: { open: boolean; onOpenChange: (open: boolean) => void; spaceId?: string | null }) {
    const t = useTranslations('dialogs.importAgent')
    const errorText = useErrorText()
    const [source, setSource] = useState<ImportSourceId | null>(null)
    const [prepared, setPrepared] = useState<Prepared | null>(null)
    const latest = useRef<ImportSourceId | null>(null)

    const pick = async (next: ImportSourceId) => {
        if (next === source) return
        setSource(next)
        setPrepared(null)
        latest.current = next
        const result = await createImportKeyAction(next, spaceId)
        if (latest.current !== next) return
        if (!result.ok) {
            toast.error(errorText(result))
            setSource(null)
            return
        }
        track('agent_import_prepared', { source: next })
        setPrepared({ source: next, connectorUrl: result.connectorUrl, prompt: result.prompt })
    }

    const handleOpenChange = (next: boolean) => {
        if (!next) {
            setSource(null)
            setPrepared(null)
            latest.current = null
        }
        onOpenChange(next)
    }

    const connectorStep = source && importSource(source).connectorStep ? t('grokConnectorStep') : undefined

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex flex-col sm:max-h-[85dvh] sm:max-w-lg sm:overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>

                <ScrollFade className="-mx-1 min-h-0 flex-1 px-1 py-1">
                    <div className="space-y-4">
                        <ImportSourcePicker value={source} onChange={pick} />

                        {source && !prepared && <PreparedSkeleton />}

                        {prepared && (
                            <div className="space-y-3">
                                <Field label={t('connectorUrl')} helperText={connectorStep}>
                                    <CopyLine value={prepared.connectorUrl} label={t('copyConnectorUrl')} />
                                </Field>
                                <Field label={t('pasteIn', { source: prepared.source === 'other' ? t('otherSource') : importSource(prepared.source).label })} helperText={t('expires')}>
                                    <CopyBlock value={prepared.prompt} label={t('copyPrompt')} wrap />
                                </Field>
                            </div>
                        )}
                    </div>
                </ScrollFade>
            </DialogContent>
        </Dialog>
    )
}
