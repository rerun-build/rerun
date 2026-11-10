'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { deleteSkillFileAction, writeSkillFileAction } from '@/app/api/_actions/agent.actions'
import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { FileTextIcon, PlusIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'

type SkillFilesSectionProps = {
    agentId: string
    slug: string
    files: string[]
    // A connector-managed skill hides these controls entirely; a sealed one keeps them in place,
    // off, wearing the reason.
    readOnly?: boolean
    addLockedReason?: string
    deleteLockedReason?: string
    onOpen: (path: string) => void
    onChanged: () => void
}

export function SkillFilesSection({ agentId, slug, files, readOnly, addLockedReason, deleteLockedReason, onOpen, onChanged }: SkillFilesSectionProps) {
    const t = useTranslations('agent.skillFilesSection')
    const errorText = useErrorText()
    const [adding, setAdding] = useState(false)
    const [newPath, setNewPath] = useState('references/')
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleAdd = useCallback(async () => {
        const path = newPath.trim()
        if (!path || path.endsWith('/')) {
            setError(t('pathRequired'))
            return
        }
        setBusy(path)
        setError(null)
        const result = await writeSkillFileAction(agentId, slug, path, '')
        setBusy(null)
        if (!result.success) {
            setError(errorText(result, t('createFailed')))
            return
        }
        setAdding(false)
        setNewPath('references/')
        onChanged()
        onOpen(path)
    }, [agentId, slug, newPath, onChanged, onOpen, t, errorText])

    const handleDelete = useCallback(async (path: string) => {
        setBusy(path)
        setError(null)
        const result = await deleteSkillFileAction(agentId, slug, path)
        setBusy(null)
        if (!result.success) setError(errorText(result, t('deleteFailed')))
        else onChanged()
    }, [agentId, slug, onChanged, t, errorText])

    return (
        <Field label={t('label')} helperText={t('helper')}>
            <div className="rounded-md border border-border divide-y divide-border">
                {files.length === 0 && !adding && <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('empty')}</p>}
                {files.map(path => (
                    <div key={path} className="flex items-center gap-1 pr-1">
                        <button type="button" onClick={() => onOpen(path)} className="flex flex-1 min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/30 transition-colors">
                            <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs font-mono">{path}</span>
                        </button>
                        {!readOnly && (
                            <TooltipDisabledReason reason={deleteLockedReason}>
                                <PanelDeleteButton
                                    label={t('deleteLabel', { path })}
                                    busy={busy === path}
                                    disabled={!!deleteLockedReason}
                                    onClick={() => handleDelete(path)}
                                    confirmTitle={t('deleteTitle', { path })}
                                    confirmDescription={t('deleteDescription')}
                                />
                            </TooltipDisabledReason>
                        )}
                    </div>
                ))}
                {adding && (
                    <div className="flex items-center gap-1.5 p-2">
                        <div className="flex-1">
                            <Input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="references/checklist.md" className="h-8 text-xs font-mono" autoFocus />
                        </div>
                        <Button size="sm" loading={!!busy} onClick={handleAdd}>
                            {t('add')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null) }}>
                            {t('cancel')}
                        </Button>
                    </div>
                )}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {!readOnly && !adding && (
                <TooltipDisabledReason reason={addLockedReason} className="w-full">
                    <Button size="sm" variant="outline" className="w-full" disabled={!!addLockedReason} onClick={() => setAdding(true)}>
                        <PlusIcon className="size-3.5 mr-1" /> {t('addFile')}
                    </Button>
                </TooltipDisabledReason>
            )}
        </Field>
    )
}
