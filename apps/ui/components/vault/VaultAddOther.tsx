'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { addVaultMcpAction, addVaultSecretAction } from '@/app/api/_actions/vault.actions'
import { McpJsonPasteSlot, McpPastedServers, PASTED_FIELD_TINT, useMcpJsonPaste } from '@/components/agent/McpJsonPaste'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { packageOf, type ParsedMcpServer } from '@/lib/engine/parse-mcp-config'
import { cn } from '@/lib/utils'
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

type Pair = { name: string; value: string }

// What a pasted server says about its target, kept whole so arguments with spaces survive.
type PastedTarget = { text: string; url?: string; transport: ParsedMcpServer['transport']; command?: string; args: string[] }

type VaultMcpForm = { name: string; target: string; headers: Pair[]; env: Pair[]; pasted?: PastedTarget }

const EMPTY_HEADER: Pair = { name: 'Authorization', value: '' }

const EMPTY_FORM: VaultMcpForm = { name: '', target: '', headers: [EMPTY_HEADER], env: [] }

const pairsOf = (record: Record<string, string>): Pair[] => Object.entries(record).map(([name, value]) => ({ name, value }))

function formOfPasted(server: ParsedMcpServer): VaultMcpForm {
    const text = server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : (server.url ?? '')
    const headers = pairsOf(server.headers)
    return {
        name: server.name,
        target: text,
        headers: headers.length > 0 ? headers : [EMPTY_HEADER],
        env: pairsOf(server.env),
        pasted: { text, url: server.url, transport: server.transport, command: server.command, args: server.args },
    }
}

const isAddress = (target: string) => /^https?:\/\//i.test(target)

type Where = { url: string; transport?: 'sse' | 'http' } | { command: string; args: string[] }

function whereOf(form: VaultMcpForm): Where {
    const target = form.target.trim()
    const { pasted } = form
    if (pasted && pasted.text.trim() === target) {
        if (pasted.transport === 'stdio') return { command: pasted.command ?? '', args: pasted.args }
        return { url: pasted.url ?? '', transport: pasted.transport }
    }
    const [command, ...args] = target.split(/\s+/)
    return isAddress(target) ? { url: target } : { command, args }
}

const identityOf = (url: string | undefined, command: string | undefined, args: string[]) => (url ? (URL.canParse(url) ? new URL(url).host : url) : `${command} ${packageOf(command, args)}`)

// The pasted secrets belong to the server they came with: once the target names another one they
// are neither shown nor sent, and they come back with it.
function keepsPasted(form: VaultMcpForm): boolean {
    if (!form.pasted) return true
    const where = whereOf(form)
    const now = 'url' in where ? identityOf(where.url, undefined, []) : identityOf(undefined, where.command, where.args)
    return now === identityOf(form.pasted.url, form.pasted.command, form.pasted.args)
}

function secretsOf(form: VaultMcpForm): { headers: Pair[]; env: Pair[] } {
    if (keepsPasted(form)) return { headers: form.headers, env: form.env }
    return { headers: [EMPTY_HEADER], env: [] }
}

const inputOf = (form: VaultMcpForm) => ({ name: form.name.trim(), ...whereOf(form), ...secretsOf(form) })

// One line per value the server needs, its name next to a value that stays masked.
function PairRows({ id, pairs, nameLabel, valueLabel, optional, valuePlaceholder, tint, onChange }: { id: string; pairs: Pair[]; nameLabel: string; valueLabel: string; optional?: boolean; valuePlaceholder?: string; tint?: string; onChange: (pairs: Pair[]) => void }) {
    const update = (index: number, patch: Partial<Pair>) => onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)))
    return (
        <div className="space-y-4 sm:space-y-2">
            {pairs.map((pair, index) => {
                const first = index === 0
                return (
                    <div key={index} className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                        <Field label={first ? nameLabel : undefined} htmlFor={`${id}-name-${index}`} optional={first && optional}>
                            <Input id={`${id}-name-${index}`} aria-label={first ? undefined : nameLabel} className={cn('font-mono', pair.value && tint)} value={pair.name} title={pair.name} onChange={e => update(index, { name: e.target.value })} />
                        </Field>
                        <Field label={first ? valueLabel : undefined} htmlFor={`${id}-value-${index}`} optional={first && optional}>
                            <Input id={`${id}-value-${index}`} aria-label={first ? undefined : valueLabel} className={cn(pair.value && tint)} type="password" autoComplete="off" value={pair.value} onChange={e => update(index, { value: e.target.value })} placeholder={valuePlaceholder} />
                        </Field>
                    </div>
                )
            })}
        </div>
    )
}

// A custom MCP server: an address (or a command the box starts) and, when it takes a key, the header
// that carries it. A server with no key signs in from the entry once added. A pasted JSON config can
// fill it with several servers, each added as an entry of its own.
export function VaultAddMcp({ onAdded, onChanged }: { onAdded: (itemId: string) => Promise<void>; onChanged: () => Promise<void> }) {
    const t = useTranslations('vault.addMcp')
    const tPaste = useTranslations('agent.mcpJsonPaste')
    const errorText = useErrorText()
    const paste = useMcpJsonPaste(EMPTY_FORM, formOfPasted)
    const { form, forms, updateForm } = paste
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const ready = forms.every(item => item.name.trim() && item.target.trim())
    const kept = keepsPasted(form)
    const { headers, env } = secretsOf(form)
    const tint = form.pasted && kept ? PASTED_FIELD_TINT : undefined
    const keyCount = [...headers, ...env].filter(pair => pair.value).length
    // Secrets typed for another server replace the pasted ones for good.
    const updateSecrets = (patch: Partial<Pick<VaultMcpForm, 'headers' | 'env'>>) => updateForm(kept ? patch : { headers, env, pasted: undefined, ...patch })

    const submit = async () => {
        setPending(true)
        setError(null)
        const added: string[] = []
        for (const item of forms) {
            const res = await addVaultMcpAction(inputOf(item))
            if (!res.ok) {
                setPending(false)
                const reason = errorText(res)
                if (added.length === 0) return setError(reason)
                paste.dropFirst(added.length)
                setError(t('partlyAdded', { count: added.length, reason }))
                return onChanged()
            }
            added.push(res.result.id)
        }
        setPending(false)
        await onAdded(added[0])
    }

    return (
        <div className="space-y-4">
            <McpPastedServers paste={paste} chip={item => ({ name: item.name, remote: 'url' in whereOf(item) })} keyCount={keyCount} />
            <Field label={t('name')} htmlFor="vault-mcp-name">
                <Input id="vault-mcp-name" className={tint} value={form.name} onChange={e => updateForm({ name: e.target.value })} onPaste={paste.onFieldPaste} placeholder={t('namePlaceholder')} autoFocus />
            </Field>
            <div className="flex flex-col gap-1.5">
                <Field label={t('target')} htmlFor="vault-mcp-target" helperText={t('targetHint')}>
                    <Input id="vault-mcp-target" className={cn('font-mono', tint)} value={form.target} onChange={e => updateForm({ target: e.target.value })} onPaste={paste.onFieldPaste} placeholder="https://mcp.example.com/mcp" />
                </Field>
                <McpJsonPasteSlot paste={paste} idleLabel={tPaste('linkVault')} />
            </div>
            <PairRows id="vault-mcp-header" pairs={headers} nameLabel={t('header')} valueLabel={t('headerValue')} optional valuePlaceholder="Bearer …" tint={tint} onChange={next => updateSecrets({ headers: next })} />
            {env.length > 0 && <PairRows id="vault-mcp-env" pairs={env} nameLabel={t('variable')} valueLabel={t('headerValue')} tint={tint} onChange={next => updateSecrets({ env: next })} />}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
                <TooltipDisabledReason reason={ready ? undefined : t('incomplete')}>
                    <Button size="sm" loading={pending} disabled={!ready || pending} onClick={() => void submit()}>
                        {forms.length > 1 ? t('addServers', { count: forms.length }) : t('add')}
                    </Button>
                </TooltipDisabledReason>
            </div>
        </div>
    )
}
