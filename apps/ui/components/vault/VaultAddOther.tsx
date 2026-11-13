'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { addVaultMcpAction, addVaultSecretAction } from '@/app/api/_actions/vault.actions'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useErrorText } from '@/hooks/useErrorText'
import { VAULT_ENV_KEY_RE } from '@rerun/contracts'

// A variable name as people type it: "stripe key" becomes STRIPE_KEY.
export function toVariableName(text: string): string {
    return text
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

// A free secret: a name for people, a variable for the coworkers, a value never shown again.
export function VaultAddSecret({ onAdded }: { onAdded: (itemId: string) => Promise<void> }) {
    const t = useTranslations('vault.addSecret')
    const errorText = useErrorText()
    const [name, setName] = useState('')
    const [key, setKey] = useState('')
    const [keyTouched, setKeyTouched] = useState(false)
    const [value, setValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const variable = keyTouched ? key : toVariableName(name)
    const validKey = VAULT_ENV_KEY_RE.test(variable)
    const ready = name.trim() && validKey && value

    const submit = async () => {
        setPending(true)
        setError(null)
        const res = await addVaultSecretAction({ name: name.trim(), key: variable, value })
        setPending(false)
        if (!res.ok) return setError(errorText(res))
        await onAdded(res.result.id)
    }

    return (
        <div className="space-y-4">
            <Field label={t('name')} htmlFor="vault-secret-name">
                <Input id="vault-secret-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('namePlaceholder')} autoFocus />
            </Field>
            <Field label={t('variable')} htmlFor="vault-secret-key" helperText={t('variableHint')} error={variable && !validKey ? t('variableInvalid') : undefined}>
                <Input
                    id="vault-secret-key"
                    className="font-mono"
                    value={variable}
                    onChange={e => {
                        setKeyTouched(true)
                        setKey(toVariableName(e.target.value))
                    }}
                    placeholder="STRIPE_API_KEY"
                />
            </Field>
            <Field label={t('value')} htmlFor="vault-secret-value" helperText={t('valueHint')}>
                <Input id="vault-secret-value" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} />
            </Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
                <Button size="sm" disabled={!ready || pending} onClick={() => void submit()}>
                    {t('add')}
                </Button>
            </div>
        </div>
    )
}

// A custom MCP server: an address (or a command the box starts) and, when it takes a key, the header
// that carries it. A server with no key signs in from the entry once added.
export function VaultAddMcp({ onAdded }: { onAdded: (itemId: string) => Promise<void> }) {
    const t = useTranslations('vault.addMcp')
    const errorText = useErrorText()
    const [name, setName] = useState('')
    const [target, setTarget] = useState('')
    const [header, setHeader] = useState('Authorization')
    const [value, setValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const remote = /^https?:\/\//i.test(target.trim())
    const ready = name.trim() && target.trim()

    const submit = async () => {
        setPending(true)
        setError(null)
        const [command, ...args] = target.trim().split(/\s+/)
        const res = await addVaultMcpAction({
            name: name.trim(),
            ...(remote ? { url: target.trim() } : { command, args }),
            headers: value ? [{ name: header, value }] : [],
        })
        setPending(false)
        if (!res.ok) return setError(errorText(res))
        await onAdded(res.result.id)
    }

    return (
        <div className="space-y-4">
            <Field label={t('name')} htmlFor="vault-mcp-name">
                <Input id="vault-mcp-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('namePlaceholder')} autoFocus />
            </Field>
            <Field label={t('target')} htmlFor="vault-mcp-target" helperText={t('targetHint')}>
                <Input id="vault-mcp-target" className="font-mono" value={target} onChange={e => setTarget(e.target.value)} placeholder="https://mcp.example.com/mcp" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <Field label={t('header')} htmlFor="vault-mcp-header" optional>
                    <Input id="vault-mcp-header" className="font-mono" value={header} onChange={e => setHeader(e.target.value)} />
                </Field>
                <Field label={t('headerValue')} htmlFor="vault-mcp-value" optional>
                    <Input id="vault-mcp-value" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="Bearer …" />
                </Field>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
                <Button size="sm" disabled={!ready || pending} onClick={() => void submit()}>
                    {t('add')}
                </Button>
            </div>
        </div>
    )
}
