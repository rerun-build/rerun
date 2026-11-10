import { HITL_CANCELLED, pendingServices, serializeServiceSetupResult, type AuthMethodSummary, type ResolvedService, type ServiceSetupOutcome } from '@rerun/contracts'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { installService, resolveServices } from '@/api/services'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import { TextField } from '@/components/ui/TextField'
import { runConnect } from '@/lib/oauth-connect'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'
import { HitlSteps } from './HitlSteps'
import type { HitlWidgetProps } from './registry'

type Entry = { slug: string; name: string; outcome: ServiceSetupOutcome }

// A paid app picks its account in a web-only picker; everything else connects from the phone.
const APP_ONLY_ON_WEB = 'app'

function methodOf(service: ResolvedService): AuthMethodSummary | undefined {
    return service.authMethods.find(method => method.id === service.installedMethodId) ?? service.authMethods.find(method => method.recommended) ?? service.authMethods[0]
}

function ServiceHeader({ service }: { service: ResolvedService }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, overflow: 'hidden', backgroundColor: theme.muted, alignItems: 'center', justifyContent: 'center' }}>
                {service.icon?.startsWith('http') ? (
                    <Image source={{ uri: service.icon }} contentFit="contain" style={{ width: 28, height: 28 }} />
                ) : (
                    <AppText variant="headline" tone="muted">
                        {service.name.charAt(0)}
                    </AppText>
                )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body" medium numberOfLines={1}>
                    {service.name}
                </AppText>
                <AppText variant="footnote" tone="muted" numberOfLines={3}>
                    {service.reason || service.summary}
                </AppText>
            </View>
        </View>
    )
}

// The apps a coworker suggests connecting, one at a time. A sign-in opens in the in-app browser and
// comes back to the app; a key is typed here and goes onto the Box. The reply leaves once every app
// is connected or skipped.
export function ServiceWidget({ pending, agentId, onAnswer, webUrl }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const [services, setServices] = useState<ResolvedService[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [index, setIndex] = useState(0)
    const [entries, setEntries] = useState<(Entry | null)[]>([])
    const [values, setValues] = useState<Record<string, Record<string, string>>>({})
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const sent = useRef(false)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        resolveServices({ accessToken, workspaceId }, agentId, pendingServices(pending.input))
            .then(list => {
                setServices(list)
                setEntries(list.map(service => (service.notFound ? { slug: service.slug, name: service.name, outcome: 'not-found' } : service.installStatus === 'active' ? { slug: service.slug, name: service.name, outcome: 'connected' } : null)))
                const open = list.findIndex(service => !service.notFound && service.installStatus !== 'active')
                setIndex(open >= 0 ? open : 0)
            })
            .catch(() => setFailed(true))
    }, [accessToken, workspaceId, agentId, pending.input])

    useEffect(() => {
        if (!services || sent.current || entries.length === 0 || entries.some(entry => entry === null)) return
        sent.current = true
        onAnswer(serializeServiceSetupResult(entries.filter((entry): entry is Entry => entry !== null)))
    }, [services, entries, onAnswer])

    if (failed) {
        return (
            <HitlCard symbol="link" label={t('service.label')}>
                <AppText variant="callout" tone="muted">
                    {t('service.loadFailed')}
                </AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm }}>
                    <HitlAction label={t('actions.notNow')} onPress={() => onAnswer(HITL_CANCELLED.service)} />
                    <HitlAction label={t('actions.openOnWeb')} primary onPress={() => WebBrowser.openBrowserAsync(webUrl)} />
                </View>
            </HitlCard>
        )
    }
    if (!services) {
        return (
            <HitlCard symbol="link" label={t('service.label')}>
                <AppText variant="callout" tone="muted">
                    {t('service.loading')}
                </AppText>
            </HitlCard>
        )
    }

    const service = services[index]
    if (!service) return null
    const method = methodOf(service)
    const typed = values[service.slug] ?? {}

    const goTo = (next: number) => {
        setIndex(next)
        setError(null)
    }

    const settle = (outcome: ServiceSetupOutcome) => {
        const next = entries.map((entry, at) => (at === index ? { slug: service.slug, name: service.name, outcome } : entry))
        setEntries(next)
        setValues(current => ({ ...current, [service.slug]: {} }))
        setError(null)
        const open = next.findIndex(entry => entry === null)
        if (open >= 0) setIndex(open)
    }

    const connect = async () => {
        if (!caller || !method) return
        setBusy(true)
        setError(null)
        try {
            const result = await installService(caller, agentId, service.slug, typed, method.id)
            if (result.status === 'installed') return settle('connected')
            if (result.status === 'needs_config') return setError(result.message)
            if (result.pendingAuth === APP_ONLY_ON_WEB) return setError(t('service.webOnly'))
            const outcome = await runConnect(caller, agentId, service.slug)
            if (outcome.status === 'connected') settle('connected')
            else if (outcome.status === 'error') setError(outcome.message)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('service.connectFailed'))
        } finally {
            setBusy(false)
        }
    }

    const missing = (method?.inputs ?? []).some(input => input.required && !typed[input.key]?.trim())
    const decided = entries[index]

    return (
        <HitlCard symbol="link" label={t('service.label')}>
            <HitlSteps
                count={services.length}
                index={index}
                onIndexChange={goTo}
                done={at => entries[at] !== null}
                renderStep={at => {
                    const step = services[at]
                    const outcome = entries[at]?.outcome
                    const stepValues = values[step.slug] ?? {}
                    return (
                        <>
                            <ServiceHeader service={step} />
                            {outcome ? (
                                <AppText variant="callout" tone="muted">
                                    {outcome === 'connected' ? t('service.connected', { name: step.name }) : outcome === 'not-found' ? t('service.notFound') : t('service.skipped')}
                                </AppText>
                            ) : (
                                (methodOf(step)?.inputs ?? []).map(input => (
                                    <TextField
                                        key={input.key}
                                        id={input.key}
                                        verbatim
                                        label={input.label}
                                        help={input.help}
                                        placeholder={input.placeholder}
                                        secret={input.secret || input.type === 'password'}
                                        value={stepValues[input.key] ?? ''}
                                        onChangeText={text => setValues(current => ({ ...current, [step.slug]: { ...current[step.slug], [input.key]: text } }))}
                                    />
                                ))
                            )}
                            {at === index && error && (
                                <AppText variant="footnote" tone="destructive">
                                    {error}
                                </AppText>
                            )}
                        </>
                    )
                }}
                actions={
                    !decided && (
                        <>
                            <HitlAction label={services.length > 1 ? t('actions.skip') : t('actions.notNow')} onPress={() => settle('skipped')} disabled={busy} />
                            <HitlAction label={busy ? t('actions.connecting') : t('actions.connect')} primary disabled={busy || missing || !method} onPress={connect} />
                        </>
                    )
                }
            />
        </HitlCard>
    )
}
