'use client'

import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import type { AgentVariables } from '@/hooks/useAgentVariables'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

// Horizontal padding is cancelled by an equal negative margin, and the outline is an inset ring
// rather than a border: the token sits in a mirror layered over a plain textarea, so anything that
// takes up space would drift the highlight away from the text underneath it.
const TOKEN_BASE = 'pointer-events-auto inline cursor-pointer rounded-[3px] -mx-0.5 px-0.5 ring-1 ring-inset transition-colors'
// Status colours rather than the brand accent, matching the tones the popover badge uses.
const TOKEN_SET = 'bg-emerald-400/10 text-emerald-600 ring-emerald-400/40 hover:bg-emerald-400/20 dark:text-emerald-400'
const TOKEN_UNSET = 'bg-orange-500/10 text-orange-600 ring-orange-500/40 hover:bg-orange-500/20 dark:text-orange-400'

export function McpVariableToken({ name, vars }: { name: string; vars: AgentVariables }) {
    const t = useTranslations('agent.mcpVariableToken')
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const source = vars.source(name)
    const isDefined = source !== null

    const run = async (op: Promise<string | null>) => {
        setBusy(true)
        setError(null)
        const failure = await op
        setBusy(false)
        if (failure) setError(failure)
        else setOpen(false)
    }

    return (
        <>
            <Popover
                open={open}
                onOpenChange={next => {
                    setOpen(next)
                    if (!next) {
                        setValue('')
                        setError(null)
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <button type="button" aria-label={t('editVariable', { name })} className={`${TOKEN_BASE} ${isDefined ? TOKEN_SET : TOKEN_UNSET}`}>
                        {`\${${name}}`}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" onOpenAutoFocus={e => e.preventDefault()}>
                    <PopoverHeader className="flex-row items-center justify-between gap-2">
                        <PopoverTitle className="min-w-0 truncate font-mono text-xs">{name}</PopoverTitle>
                        <Badge size="xs" glow={false} tone={isDefined ? 'green' : 'orange'}>
                            {source === 'agent' ? t('statusSaved') : source === 'engine' ? t('statusEngine') : t('statusUnset')}
                        </Badge>
                    </PopoverHeader>

                    <Input
                        autoFocus
                        type="password"
                        autoComplete="off"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && value.trim()) run(vars.save(name, value))
                        }}
                        placeholder={source === 'agent' ? '••••••••' : source === 'engine' ? t('placeholderOverride') : t('placeholderNew')}
                        className="h-8 font-mono text-sm"
                        helperText={source === 'agent' ? t('helperSaved') : source === 'engine' ? t('helperEngine') : t('helperUnset')}
                    />

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    <div className="flex items-center gap-2">
                        {source === 'agent' && <PanelDeleteButton label={t('remove', { name })} confirm={false} disabled={busy} onClick={() => setConfirmRemove(true)} />}
                        <Button size="sm" className="flex-1" loading={busy} disabled={!value.trim()} onClick={() => run(vars.save(name, value))}>
                            {t('save')}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Hors du Popover : l'ouverture de la dialog compte comme une interaction extérieure et
            ferme le popover, qui emporterait la dialog avec lui. */}
            <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title={t('removeConfirm', { name })} description={t('removeDescription')} confirmLabel={t('removeAction')} onConfirm={() => run(vars.remove(name))} />
        </>
    )
}
