'use client'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { updateAgentKeysAction } from '@/app/api/_actions/agent.actions'
import { McpVarTextarea } from '@/components/agent/McpVarTextarea'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PanelDeleteButton, PanelEditorBody, PanelEditorFooter, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useAgentVariables } from '@/hooks/useAgentVariables'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { argsHaveSecret, externalizeArgs, externalizePairs, externalizeUrl, sanitize, urlHasSecret } from '@/lib/engine/mcp-secrets'
import type { EngineMcpServer } from '@/lib/engine/types'
import { MCP_SERVER_NAME_RE } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

const VARIABLE_TOKEN = '${NAME}'

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
    onSave: (server: EngineMcpServer) => Promise<{ success: boolean } & Refusal>
    onDelete?: () => Promise<{ success: boolean } & Refusal>
    onDone: () => void
    onBack: () => void
}) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.mcpServerEditor')
    const errorText = useErrorText()
    const isEdit = !!server
    const [name, setName] = useState(server?.name ?? '')
    const [transport, setTransport] = useState<'stdio' | 'sse' | 'http'>(server?.transport ?? 'stdio')
    const [command, setCommand] = useState(server?.command ?? '')
    const [argsText, setArgsText] = useState((server?.args ?? []).join('\n'))
    const [url, setUrl] = useState(server?.url ?? '')
    const [envText, setEnvText] = useState(
        Object.entries(server?.env ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
    )
    const [headersText, setHeadersText] = useState(
        Object.entries(server?.headers ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
    )
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const vars = useAgentVariables(agentId)
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason
    // `readOnly` is a server an app owns, with no footer at all. A use-only member keeps the footer, disabled, to read why.
    const fieldsLocked = readOnly || !canManage

    const handleSave = useCallback(async () => {
        setSaving(true)
        setError(null)

        const serverName = name.trim()
        if (!MCP_SERVER_NAME_RE.test(serverName)) {
            setSaving(false)
            setError(t('invalidName'))
            return
        }
        const isStdio = transport === 'stdio'
        const stdioArgs = isStdio ? externalizeArgs(parseArgs(argsText), serverName) : null
        const httpUrl = isStdio ? null : externalizeUrl(url.trim(), serverName)
        const env = externalizePairs(parsePairs(envText))
        const headers = isStdio ? null : externalizePairs(parsePairs(headersText), `MCP_${sanitize(serverName)}_`)
        const keysSet: Record<string, string> = { ...stdioArgs?.keys, ...httpUrl?.keys, ...env.keys, ...headers?.keys }

        const next: EngineMcpServer = {
            name: serverName,
            transport,
            args: stdioArgs?.value ?? [],
            env: env.value,
            headers: headers?.value ?? (isStdio ? (server?.headers ?? {}) : {}),
            ...(isStdio ? { command: command.trim() || undefined } : { url: httpUrl?.value || undefined }),
        }

        if (Object.keys(keysSet).length > 0) {
            const keysResult = await updateAgentKeysAction(agentId, { set: keysSet })
            if (!keysResult.success) {
                setSaving(false)
                setError(errorText(keysResult, t('storeCredentialsFailed')))
                return
            }
            vars.markDefined(Object.keys(keysSet))
        }

        const result = await onSave(next)
        setSaving(false)
        if (result.success) onDone()
        else setError(errorText(result, t('saveFailed')))
    }, [agentId, name, transport, command, argsText, url, envText, headersText, server, vars, onSave, onDone, t, errorText])

    const handleDelete = useCallback(async () => {
        if (!onDelete) return
        setDeleting(true)
        const result = await onDelete()
        setDeleting(false)
        if (result.success) onDone()
        else setError(errorText(result, t('deleteFailed')))
    }, [onDelete, onDone, t, errorText])

    const canSave = name.trim() && (transport === 'stdio' ? command.trim() : url.trim())
    const secretWarning = t('secretWarning', { token: VARIABLE_TOKEN })
    const argsWarning = useMemo(() => (argsHaveSecret(parseArgs(argsText)) ? secretWarning : null), [argsText, secretWarning])
    const urlWarning = useMemo(() => (urlHasSecret(url.trim()) ? secretWarning : null), [url, secretWarning])

    return (
        <PanelEditorShell>
            <PanelEditorHeader title={fieldsLocked ? t('titleReadOnly') : isEdit ? t('titleEdit') : t('titleNew')} onBack={onBack} />
            <PanelEditorBody>
                {error && <p className="text-xs text-destructive">{error}</p>}
                {readOnly && <p className="text-xs text-muted-foreground">{t('providedByApp')}</p>}
                <Input label={t('name')} helperText={t('nameHelper', { prefix: name.trim() || t('namePrefixFallback'), tool: '<tool>' })} hideRequired disabled={fieldsLocked} value={name} onChange={e => setName(e.target.value)} placeholder="filesystem" className="h-8 text-sm" />

                <Field label={t('transport')}>
                    <div className="flex gap-1 rounded-md border border-border p-0.5">
                        <button type="button" disabled={fieldsLocked} onClick={() => setTransport('stdio')} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${transport === 'stdio' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
                            stdio
                        </button>
                        <button type="button" disabled={fieldsLocked} onClick={() => setTransport('sse')} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${transport === 'sse' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
                            sse
                        </button>
                        <button type="button" disabled={fieldsLocked} onClick={() => setTransport('http')} className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${transport === 'http' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
                            http
                        </button>
                    </div>
                </Field>

                {transport === 'stdio' ? (
                    <>
                        <Input label={t('command')} hideRequired disabled={fieldsLocked} value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" className="h-8 text-sm font-mono" />
                        <McpVarTextarea
                            label={t('arguments')}
                            helperText={fieldsLocked ? t('argumentsHelper') : t('argumentsHelperEditable', { token: VARIABLE_TOKEN })}
                            warning={argsWarning}
                            value={argsText}
                            onChange={setArgsText}
                            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path'}
                            vars={vars}
                            minHeightClassName="min-h-20"
                            disabled={fieldsLocked}
                        />
                    </>
                ) : (
                    <McpVarTextarea
                        label={t('url')}
                        helperText={fieldsLocked ? undefined : t('urlHelper', { token: VARIABLE_TOKEN })}
                        warning={urlWarning}
                        value={url}
                        onChange={setUrl}
                        placeholder="https://example.com/sse"
                        vars={vars}
                        minHeightClassName="min-h-8"
                        singleLine
                        disabled={fieldsLocked}
                    />
                )}

                <McpVarTextarea label={t('environment')} helperText={fieldsLocked ? t('environmentHelper') : t('environmentHelperEditable', { token: VARIABLE_TOKEN })} value={envText} onChange={setEnvText} placeholder={'API_KEY=...\nOTHER=value'} vars={vars} disabled={fieldsLocked} />

                {transport !== 'stdio' && (
                    <McpVarTextarea label={t('headers')} helperText={fieldsLocked ? t('headersHelper') : t('headersHelperEditable', { token: VARIABLE_TOKEN })} value={headersText} onChange={setHeadersText} placeholder={'Authorization=Bearer ...\nx-auth-token=...'} vars={vars} disabled={fieldsLocked} />
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
                                confirmTitle={name ? t('deleteConfirm', { name }) : t('deleteConfirmUnnamed')}
                                confirmDescription={t('deleteDescription')}
                            />
                        </TooltipDisabledReason>
                    )}
                    <TooltipDisabledReason reason={manageReason} className="flex-1">
                        <Button size="sm" className="flex-1" loading={saving} onClick={handleSave} disabled={deleting || !canSave || !canManage}>
                            {isEdit ? t('saveChanges') : t('createServer')}
                        </Button>
                    </TooltipDisabledReason>
                </PanelEditorFooter>
            )}
        </PanelEditorShell>
    )
}
