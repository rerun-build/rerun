'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useState, type ClipboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { parseMcpConfig, type McpConfigError, type ParsedMcpServer } from '@/lib/engine/parse-mcp-config'
import { AlertCircleIcon, ClipboardPasteIcon, GlobeIcon, KeyIcon, TerminalIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const JSON_EXAMPLE = '{ "mcpServers": { … } }'

// The servers a pasted JSON filled a form with, one form per server, the first one shown. Without a
// paste it holds the single form the user types into.
export function useMcpJsonPaste<Form>(initial: Form, toForm: (server: ParsedMcpServer) => Form) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const [error, setError] = useState<McpConfigError | null>(null)
    const [servers, setServers] = useState<ParsedMcpServer[]>([])
    const [forms, setForms] = useState<Form[]>([initial])
    const [selected, setSelected] = useState(0)

    const apply = useCallback(
        (next: string) => {
            setText(next)
            const result = parseMcpConfig(next)
            if (!result.ok) {
                setError(result.error)
                return false
            }
            setError(null)
            if (result.servers.length === 0) return false
            setServers(result.servers)
            setForms(result.servers.map(toForm))
            setSelected(0)
            setOpen(false)
            setText('')
            return true
        },
        [toForm],
    )

    // A JSON pasted straight into the name, the command or the address counts too: nobody has to find the link.
    const onFieldPaste = useCallback(
        (event: ClipboardEvent<HTMLElement>) => {
            const pasted = event.clipboardData.getData('text')
            if (!pasted.trim().startsWith('{')) return
            event.preventDefault()
            if (!apply(pasted)) {
                setText(pasted)
                setOpen(true)
            }
        },
        [apply],
    )

    return {
        open,
        text,
        error,
        apply,
        onFieldPaste,
        openBox: () => setOpen(true),
        closeBox: () => {
            setOpen(false)
            setText('')
            setError(null)
        },
        servers,
        pasted: servers[selected] as ParsedMcpServer | undefined,
        forms,
        form: forms[selected],
        selected,
        select: setSelected,
        updateForm: (patch: Partial<Form>) => setForms(all => all.map((item, index) => (index === selected ? { ...item, ...patch } : item))),
        // The servers already saved when a later one failed: a retry must not add them twice.
        dropFirst: (count: number) => {
            setServers(all => all.slice(count))
            setForms(all => all.slice(count))
            setSelected(0)
        },
    }
}

export type McpJsonPaste<Form> = ReturnType<typeof useMcpJsonPaste<Form>>

function useConfigErrorText() {
    const t = useTranslations('agent.mcpJsonPaste.errors')
    return (error: McpConfigError) => {
        switch (error.code) {
            case 'invalidJson':
                return t('invalidJson', { detail: error.detail })
            case 'notAnObject':
                return t('notAnObject', { example: JSON_EXAMPLE })
            case 'containerNotObject':
            case 'noServer':
            case 'emptyContainer':
                return t(error.code)
            default: {
                const { code, ...values } = error
                return t(code, values)
            }
        }
    }
}

// The discreet link under a field; it opens the paste box in its place, so the form never jumps.
export function McpJsonPasteSlot<Form>({ paste, idleLabel }: { paste: McpJsonPaste<Form>; idleLabel?: string }) {
    const t = useTranslations('agent.mcpJsonPaste')
    const errorText = useConfigErrorText()

    if (!paste.open) {
        return (
            <button type="button" onClick={paste.openBox} className="-mt-1 inline-flex min-h-6 items-center gap-1.5 self-start text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
                <ClipboardPasteIcon className="size-3.5" />
                {paste.servers.length > 0 ? t('linkAgain') : (idleLabel ?? t('link'))}
            </button>
        )
    }

    return (
        <div className="space-y-2">
            <div className="relative">
                <textarea
                    aria-label={t('boxLabel')}
                    aria-invalid={paste.error ? true : undefined}
                    spellCheck={false}
                    autoFocus
                    value={paste.text}
                    onChange={e => paste.apply(e.target.value)}
                    placeholder={t('placeholder', { example: JSON_EXAMPLE })}
                    className="field-sizing-content max-h-40 min-h-20 w-full resize-none rounded-lg border border-dashed border-input bg-transparent py-2 pe-8 ps-2.5 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-solid focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-solid aria-invalid:border-destructive dark:bg-input/30"
                />
                <Button size="icon-xs" variant="ghost" aria-label={t('close')} className="absolute top-1.5 end-1.5" onClick={paste.closeBox}>
                    <XIcon />
                </Button>
            </div>
            {paste.error && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
                    <span className="min-w-0 break-words">{errorText(paste.error)}</span>
                </p>
            )}
        </div>
    )
}

// After a paste: one chip per server when there are several, and how many values become keys.
export function McpPastedServers<Form>({ paste, chip, keyCount }: { paste: McpJsonPaste<Form>; chip: (form: Form) => { name: string; remote: boolean }; keyCount: number }) {
    const t = useTranslations('agent.mcpJsonPaste')
    if (paste.servers.length === 0) return null

    return (
        <div className="space-y-2">
            {paste.forms.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                    {paste.forms.map((form, index) => {
                        const { name, remote } = chip(form)
                        return (
                            <button
                                key={index}
                                type="button"
                                aria-pressed={index === paste.selected}
                                onClick={() => paste.select(index)}
                                className={cn('inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 font-mono text-xs transition-colors', index === paste.selected ? 'border-primary/40 text-primary ring-1 ring-primary/40' : 'text-muted-foreground hover:text-foreground')}
                            >
                                {remote ? <GlobeIcon className="size-3 shrink-0" /> : <TerminalIcon className="size-3 shrink-0" />}
                                <span className="truncate">{name || t('unnamed')}</span>
                            </button>
                        )
                    })}
                </div>
            )}
            {keyCount > 0 && (
                <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <KeyIcon className="size-3 shrink-0" />
                    {t('keysStored', { count: keyCount })}
                </p>
            )}
        </div>
    )
}

export const PASTED_FIELD_TINT = 'bg-brand/5 dark:bg-brand/5'
