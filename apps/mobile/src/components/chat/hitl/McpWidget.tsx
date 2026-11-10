import { HITL_CANCELLED, pendingMcpSignIn, serializeMcpSignInResult, type McpServerView } from '@rerun/contracts'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { readMcpServer } from '@/api/mcp'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { runMcpConnect } from '@/lib/oauth-connect'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'
import type { HitlWidgetProps } from './registry'

// The web's status badge: an unknown status shows nothing rather than a guess.
function StatusBadge({ status }: { status: McpServerView['status'] }) {
    const t = useTranslations('mobileHitl.mcp')
    if (status === 'connected') return <Badge size="xs" tone="green" label={t('connected')} />
    if (status === 'needs_auth') return <Badge size="xs" tone="orange" label={t('signInNeeded')} />
    if (status === 'error') return <Badge size="xs" tone="red" label={t('unreachable')} />
    return null
}

type McpSignInCardProps = {
    name: string
    reason?: string
    server: McpServerView | null
    loading: boolean
    busy: boolean
    error: string | null
    onSkip: () => void
    onConnect: () => void
    onContinue: () => void
}

export function McpSignInCard({ name, reason, server, loading, busy, error, onSkip, onConnect, onContinue }: McpSignInCardProps) {
    const t = useTranslations('mobileHitl')
    const theme = useTheme()
    const displayName = server?.displayName ?? name
    const subtitle = reason ?? (server?.host ? t('mcp.customServerAt', { host: server.host }) : t('mcp.customServer'))
    const connected = server?.status === 'connected'
    return (
        <HitlCard symbol="link" label={t('mcp.label')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ width: 40, height: 40, borderRadius: radius.md, overflow: 'hidden', backgroundColor: theme.muted, alignItems: 'center', justifyContent: 'center' }}>
                    {server?.icon?.startsWith('http') ? (
                        <Image source={{ uri: server.icon }} contentFit="contain" style={{ width: 28, height: 28 }} />
                    ) : (
                        <AppText variant="headline" tone="muted">
                            {displayName.charAt(0).toUpperCase()}
                        </AppText>
                    )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body" medium numberOfLines={1}>
                        {t('mcp.signInTo', { name: displayName })}
                    </AppText>
                    <AppText variant="footnote" tone="muted" numberOfLines={3}>
                        {subtitle}
                    </AppText>
                </View>
            </View>
            {server && <StatusBadge status={server.status} />}
            {error && (
                <AppText variant="footnote" tone="destructive">
                    {error}
                </AppText>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm }}>
                <HitlAction label={t('actions.notNow')} onPress={onSkip} disabled={busy} />
                {connected ? <HitlAction label={t('actions.continue')} primary onPress={onContinue} disabled={busy} /> : <HitlAction label={busy ? t('actions.connecting') : loading ? t('actions.loading') : t('actions.connect')} primary onPress={onConnect} disabled={busy || loading || !server?.canSignIn} />}
            </View>
        </HitlCard>
    )
}

// The sign-in a coworker asks for after registering a server that answered 401: the person connects
// here in the in-app browser and the coworker picks up on its own, as on the web.
export function McpWidget({ pending, agentId, onAnswer }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl.mcp')
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const { name, reason } = pendingMcpSignIn(pending.input)
    const [server, setServer] = useState<McpServerView | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loadFailed, setLoadFailed] = useState(false)
    const sent = useRef(false)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    useEffect(() => {
        if (!accessToken || !workspaceId || !name) return
        readMcpServer({ accessToken, workspaceId }, agentId, name)
            .then(setServer)
            .catch(() => setLoadFailed(true))
            .finally(() => setLoading(false))
    }, [accessToken, workspaceId, agentId, name])

    const answer = (text: string) => {
        if (sent.current) return
        sent.current = true
        onAnswer(text)
    }

    const connect = async () => {
        if (!caller) return
        setBusy(true)
        setError(null)
        setLoadFailed(false)
        const outcome = await runMcpConnect(caller, agentId, name)
        setBusy(false)
        if (outcome.status === 'connected') answer(serializeMcpSignInResult(name))
        else if (outcome.status === 'error') setError(outcome.message)
    }

    return <McpSignInCard name={name} reason={reason} server={server} loading={loading} busy={busy} error={error ?? (loadFailed ? t('loadFailed') : null)} onSkip={() => answer(HITL_CANCELLED.mcp)} onConnect={connect} onContinue={() => answer(serializeMcpSignInResult(name))} />
}
