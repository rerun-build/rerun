'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { updateAgentKeysAction } from '@/app/api/_actions/agent.actions'
import { McpJsonPasteSlot, McpPastedServers, PASTED_FIELD_TINT, useMcpJsonPaste } from '@/components/agent/McpJsonPaste'
import { McpVarTextarea } from '@/components/agent/McpVarTextarea'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useAgentVariables } from '@/hooks/useAgentVariables'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { argsHaveSecret, externalizeArgs, externalizePairs, externalizeUrl, sanitize, separateKeys, urlHasSecret } from '@/lib/engine/mcp-secrets'
import type { ParsedMcpServer } from '@/lib/engine/parse-mcp-config'
import type { EngineMcpServer } from '@/lib/engine/types'
import { cn } from '@/lib/utils'
import { MCP_SERVER_NAME_RE } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

const VARIABLE_TOKEN = '${NAME}'

type Transport = EngineMcpServer['transport']

type ServerForm = { name: string; transport: Transport; command: string; argsText: string; url: string; envText: string; headersText: string }

const parseArgs = (text: string): string[] => text.split('\n').map(a => a.trim()).filter(Boolean)

function parsePairs(text: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const eq = trimmed.indexOf('=')
        if (eq > 0) out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return out
}

const pairsText = (pairs: Record<string, string> | undefined) =>
    Object.entries(pairs ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')

function formOf(server: EngineMcpServer | undefined): ServerForm {
    return {
        name: server?.name ?? '',
        transport: server?.transport ?? 'stdio',
        command: server?.command ?? '',
        argsText: (server?.args ?? []).join('\n'),
        url: server?.url ?? '',
        envText: pairsText(server?.env),
        headersText: pairsText(server?.headers),
    }
}

const formOfPasted = (server: ParsedMcpServer): ServerForm => ({
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    argsText: server.args.join('\n'),
    url: server.url ?? '',
    envText: pairsText(server.env),
    headersText: pairsText(server.headers),
})

// Secrets leave the config for the agent's keys: the config keeps a ${VAR} the engine resolves.
function buildServer(form: ServerForm, previous?: EngineMcpServer): { server: EngineMcpServer; keys: Record<string, string> } {
    const serverName = form.name.trim()
    const isStdio = form.transport === 'stdio'
    const stdioArgs = isStdio ? externalizeArgs(parseArgs(form.argsText), serverName) : null
    const httpUrl = isStdio ? null : externalizeUrl(form.url.trim(), serverName)
    const env = externalizePairs(parsePairs(form.envText))
    const headers = isStdio ? null : externalizePairs(parsePairs(form.headersText), `MCP_${sanitize(serverName)}_`)
    return {
        server: {
            name: serverName,
            transport: form.transport,
            args: stdioArgs?.value ?? [],
            env: env.value,
            headers: headers?.value ?? (isStdio ? (previous?.headers ?? {}) : {}),
            ...(isStdio ? { command: form.command.trim() || undefined } : { url: httpUrl?.value || undefined }),
        },
        keys: { ...stdioArgs?.keys, ...httpUrl?.keys, ...env.keys, ...headers?.keys },
    }
}

const isComplete = (form: ServerForm) => !!form.name.trim() && !!(form.transport === 'stdio' ? form.command.trim() : form.url.trim())

export function McpServerEditor({
    agentId,
    server,
    readOnly,
    onSave,
    onDelete,
    onDone,
    onBack,
}: {
    agentId: string
    server?: EngineMcpServer
    readOnly?: boolean
    // Several servers only come from a pasted JSON, when creating.
    onSave: (servers: EngineMcpServer[]) => Promise<{ success: boolean } & Refusal>
    onDelete?: () => Promise<{ success: boolean } & Refusal>
    onDone: () => void
    onBack: () => void
}) {
    const boxManageReason = useBoxManageReason(agentId)
    const t = useTranslations('agent.mcpServerEditor')
    const errorText = useErrorText()
    const isEdit = !!server
    const [initialForm] = useState(() => formOf(server))
    const paste = useMcpJsonPaste(initialForm, formOfPasted)
    const { forms, form, pasted, updateForm } = paste
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const vars = useAgentVariables(agentId)
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason
    // `readOnly` is a server an app owns, with no footer at all. A use-only member keeps the footer, disabled, to read why.
    const fieldsLocked = readOnly || !canManage
    const canPaste = !isEdit && !fieldsLocked
    const onFieldPaste = canPaste ? paste.onFieldPaste : undefined
    const tint = pasted ? PASTED_FIELD_TINT : undefined

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)

        const invalid = forms.find(item => !MCP_SERVER_NAME_RE.test(item.name.trim()))
        if (invalid) {
            setSaving(false)
            setError(t('invalidName'))
            return
        }
        const names = forms.map(item => item.name.trim())
        const duplicate = names.find((name, index) => names.indexOf(name) !== index)
        if (duplicate) {
            setSaving(false)
            setError(t('duplicateName', { name: duplicate }))
            return
        }
        const keysSet: Record<string, string> = {}
        const built = forms.map(item => {
            const draft = buildServer(item, server)
            const separated = separateKeys(draft.server, draft.keys, keysSet)
            Object.assign(keysSet, separated.keys)
            return separated.server
        })

        if (Object.keys(keysSet).length > 0) {
            const keysResult = await updateAgentKeysAction(agentId, { set: keysSet })
            if (!keysResult.success) {
                setSaving(false)
                setError(errorText(keysResult, t('storeCredentialsFailed')))
                return
            }
            vars.markDefined(Object.keys(keysSet))
        }

        const result = await onSave(built)
        setSaving(false)
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, forms, server, vars, onSave, onDone, t, errorText])

    const handleDelete = useCallback(async () => {
        if (!onDelete) return
        setDeleting(true)
        const result = await onDelete()
        setDeleting(false)
        if (result.success) onDone()
        else setError(errorText(result, t('deleteFailed')))
    }, [onDelete, onDone, t, errorText])

    const canSave = forms.every(isComplete)
    const keyCount = useMemo(() => (pasted ? Object.keys(buildServer(form).keys).length : 0), [pasted, form])
    const secretWarning = t('secretWarning', { token: VARIABLE_TOKEN })
    const argsWarning = useMemo(() => (argsHaveSecret(parseArgs(form.argsText)) ? secretWarning : null), [form.argsText, secretWarning])
    const urlWarning = useMemo(() => (urlHasSecret(form.url.trim()) ? secretWarning : null), [form.url, secretWarning])
    const nameHelper = pasted?.nameProposed && form.name === pasted.name ? t('nameProposed', { source: pasted.url ? 'address' : 'package' }) : t('nameHelper', { prefix: form.name.trim() || t('namePrefixFallback'), tool: '<tool>' })
    const transportHelper = pasted?.transportGuessed && form.transport === pasted.transport ? t('transportGuessed') : undefined
    const saveReason = manageReason ?? (canSave ? undefined : t('incomplete'))

    return (
        <PanelEditorShell>
            <PanelEditorHeader title={fieldsLocked ? t('titleReadOnly') : isEdit ? t('titleEdit') : t('titleNew')} onBack={onBack} />
            <PanelEditorBody>
                {error && <p className="text-xs text-destructive">{error}</p>}
                {readOnly && <p className="text-xs text-muted-foreground">{t('providedByApp')}</p>}
                <McpPastedServers paste={paste} chip={item => ({ name: item.name, remote: item.transport !== 'stdio' })} keyCount={keyCount} />
                <Input label={t('name')} helperText={nameHelper} hideRequired disabled={fieldsLocked} value={form.name} onChange={e => updateForm({ name: e.target.value })} onPaste={onFieldPaste} placeholder="filesystem" className={cn('h-8 text-sm', tint)} />

                <Field label={t('transport')} helperText={transportHelper}>
                    <div className="flex gap-1 rounded-md border border-border p-0.5">
                        {(['stdio', 'sse', 'http'] as const).map(option => (
                            <button key={option} type="button" disabled={fieldsLocked} onClick={() => updateForm({ transport: option })} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${form.transport === option ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
                                {option}
                            </button>
                        ))}
                    </div>
                </Field>

                {form.transport === 'stdio' ? (
                    <>
                        <Input label={t('command')} hideRequired disabled={fieldsLocked} value={form.command} onChange={e => updateForm({ command: e.target.value })} onPaste={onFieldPaste} placeholder="npx" className={cn('h-8 font-mono text-sm', tint)} />
                        {canPaste && <McpJsonPasteSlot paste={paste} />}
                        <McpVarTextarea
                            label={t('arguments')}
                            helperText={fieldsLocked ? t('argumentsHelper') : t('argumentsHelperEditable', { token: VARIABLE_TOKEN })}
                            warning={argsWarning}
                            value={form.argsText}
                            onChange={argsText => updateForm({ argsText })}
                            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                            vars={vars}
                            minHeightClassName="min-h-20"
                            disabled={fieldsLocked}
                            className={tint}
                        />
                    </>
                ) : (
                    <>
                        <McpVarTextarea
                            label={t('url')}
                            helperText={fieldsLocked ? undefined : t('urlHelper', { token: VARIABLE_TOKEN })}
                            warning={urlWarning}
                            value={form.url}
                            onChange={url => updateForm({ url })}
                            onPaste={onFieldPaste}
                            placeholder="https://example.com/sse"
                            vars={vars}
                            minHeightClassName="min-h-8"
                            singleLine
                            disabled={fieldsLocked}
                            className={tint}
                        />
                        {canPaste && <McpJsonPasteSlot paste={paste} />}
                    </>
                )}

                <McpVarTextarea label={t('environment')} helperText={fieldsLocked ? t('environmentHelper') : t('environmentHelperEditable', { token: VARIABLE_TOKEN })} value={form.envText} onChange={envText => updateForm({ envText })} placeholder={'API_KEY=...\nOTHER=value'} vars={vars} disabled={fieldsLocked} className={tint} />

                {form.transport !== 'stdio' && (
                    <McpVarTextarea label={t('headers')} helperText={fieldsLocked ? t('headersHelper') : t('headersHelperEditable', { token: VARIABLE_TOKEN })} value={form.headersText} onChange={headersText => updateForm({ headersText })} placeholder={'Authorization=Bearer ...\nx-auth-token=...'} vars={vars} disabled={fieldsLocked} className={tint} />
                )}
            </PanelEditorBody>
            {!readOnly && (
                <PanelEditorFooter>
                    {isEdit && onDelete && (
                        <TooltipDisabledReason reason={manageReason}>
                            <PanelDeleteButton
                                label={t('deleteServer')}
                                busy={deleting}
                                disabled={saving || !canManage}
                                onClick={handleDelete}
                                confirmTitle={form.name ? t('deleteConfirm', { name: form.name }) : t('deleteConfirmUnnamed')}
                                confirmDescription={t('deleteDescription')}
                            />
                        </TooltipDisabledReason>
                    )}
                    <TooltipDisabledReason reason={saveReason} className="flex-1">
                        <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={deleting || !canSave || !canManage}>
                            {isEdit ? t('saveChanges') : forms.length > 1 ? t('addServers', { count: forms.length }) : t('createServer')}
                        </Button>
                    </TooltipDisabledReason>
                </PanelEditorFooter>
            )}
        </PanelEditorShell>
    )
}
