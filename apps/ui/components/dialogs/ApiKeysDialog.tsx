'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { createApiKeyAction, listApiKeysAction, revokeApiKeyAction, type ApiKeyView } from '@/app/api/_actions/api-keys.actions'
import { ApiKeyList } from '@/components/dialogs/ApiKeyList'
import { CreatedApiKey } from '@/components/dialogs/CreatedApiKey'
import { McpSnippets } from '@/components/dialogs/McpSnippets'
import { RevokeApiKeyDialog } from '@/components/dialogs/RevokeApiKeyDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DocsLink } from '@/components/ui/docs-link'
import { Input } from '@/components/ui/input'
import { SkeletonList } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { Loader2Icon } from '@/lib/icons'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { track } from '@rerun/analytics/client'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
            {action}
        </div>
    )
}

export function ApiKeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.apiKeys')
    const errorText = useErrorText()
    const [keys, setKeys] = useState<ApiKeyView[]>([])
    const [mcpUrl, setMcpUrl] = useState('')
    const [loading, setLoading] = useState(true)
    const [draft, setDraft] = useState('')
    const [creating, setCreating] = useState(false)
    const [busy, setBusy] = useState(false)
    const [createdKey, setCreatedKey] = useState<string | null>(null)
    const [revoking, setRevoking] = useState<ApiKeyView | null>(null)
    const adminReason = useIsWorkspaceAdmin() ? undefined : t('adminOnly')

    const refresh = useCallback(async () => {
        const result = await listApiKeysAction()
        if (!result.ok) {
            toast.error(errorText(result))
            setLoading(false)
            return
        }
        setKeys(result.keys)
        setMcpUrl(result.mcpUrl)
        setLoading(false)
    }, [errorText])

    useEffect(() => {
        if (!open) return
        refresh()
    }, [open, refresh])

    // The one key shown in clear goes away with the dialog: leaving it on screen for the next
    // opening would mean holding a live secret in memory for no reason.
    const handleOpenChange = (next: boolean) => {
        if (!next) setCreatedKey(null)
        onOpenChange(next)
    }

    const create = async () => {
        const name = draft.trim()
        if (!name || creating || adminReason) return
        setCreating(true)
        const result = await createApiKeyAction(name)
        setCreating(false)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        track('api_key_created', {})
        setCreatedKey(result.key)
        setDraft('')
        refresh()
    }

    // Revoking breaks whatever runs on that key, so it goes through a confirmation rather than
    // straight off the row.
    const revoke = async () => {
        const key = revoking
        if (!key || busy) return
        setBusy(true)
        const result = await revokeApiKeyAction(key.id)
        setBusy(false)
        if (!result.ok) return toast.error(errorText(result))
        toast.success(t('revoked', { name: key.name }))
        setRevoking(null)
        refresh()
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {/* The desktop dialog has no height of its own, and the snippets plus the key list run
                past a short viewport. The bounds are sm: only: the mobile sheet already caps itself
                against the cookie bar inset, and overriding that would push it off screen. */}
            <DialogContent className="flex flex-col sm:max-h-[85dvh] sm:max-w-lg sm:overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <p className="text-sm text-muted-foreground">{t('description')}</p>
                </DialogHeader>

                <ScrollFade className="-mx-1 min-h-0 flex-1 px-1 py-1">
                    <div className="space-y-4">
                        {loading ? (
                            <SkeletonList rows={3} />
                        ) : (
                            <>
                                <section className="min-w-0 space-y-2">
                                    <SectionTitle>{t('connectSection')}</SectionTitle>
                                    {/* The fresh key takes the snippets' place rather than sitting under the fold:
                                        it is the one thing on screen that cannot be recovered by reopening the dialog. */}
                                    {createdKey ? <CreatedApiKey value={createdKey} mcpUrl={mcpUrl} onDismiss={() => setCreatedKey(null)} /> : <McpSnippets mcpUrl={mcpUrl} />}
                                </section>

                                <section className="min-w-0 space-y-2">
                                    <SectionTitle action={<DocsLink path="/api/authentication">{t('docsLink')}</DocsLink>}>{t('keysSection')}</SectionTitle>
                                    <ApiKeyList keys={keys} busy={busy} disabledReason={adminReason} onRevoke={setRevoking} />

                                    <Input
                                        label={t('newKeyName')}
                                        placeholder={t('newKeyPlaceholder')}
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                create()
                                            }
                                        }}
                                    />
                                    <div className="flex justify-end">
                                        <TooltipDisabledReason reason={adminReason}>
                                            <Button onClick={create} disabled={!draft.trim() || creating || !!adminReason}>
                                                {creating && <Loader2Icon className="animate-spin" />}
                                                {t('create')}
                                            </Button>
                                        </TooltipDisabledReason>
                                    </div>
                                </section>
                            </>
                        )}
                    </div>
                </ScrollFade>

                <RevokeApiKeyDialog apiKey={revoking} pending={busy} onOpenChange={next => !next && setRevoking(null)} onConfirm={revoke} />
            </DialogContent>
        </Dialog>
    )
}
