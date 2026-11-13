'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { AppAccountPicker } from '@rerun/cloud/apps.client'
import { AuthMethodPicker, methodKindKey } from '@/components/services/AuthMethodPicker'
import { ComposioConnect } from '@/components/services/ComposioConnect'
import { ManagedConnect } from '@/components/services/ManagedConnect'
import { ServiceFields } from '@/components/services/ServiceFields'
import { useServiceSetupDriver } from '@/components/services/service-setup-driver'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Button } from '@/components/ui/button'
import { PanelSteps } from '@/components/ui/panel-steps'
import { isAppSlug, type AppSlug } from '@rerun/cloud/apps'
import type { AppTarget, AuthMethodSummary, ComposioTarget, ManagedTarget, OAuthTarget } from '@/lib/services/types'
import { ArrowLeftIcon, CheckCircle2Icon, ExternalLinkIcon, Loader2Icon } from '@/lib/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'

type ServiceConfigFormProps = {
    agentId: string
    slug: string
    // Which account of the app this form sets up, when it is not the base one (`slug@id`).
    instanceKey?: string
    // Adds another account next to the ones the coworker holds; its key comes back from the install.
    newInstance?: boolean
    name: string
    authMethods: AuthMethodSummary[]
    // Pre-select a method (e.g. the one a previous install used); defaults to recommended.
    initialMethodId?: string
    // Open straight on the sign-in step for a service already compiled and waiting on auth,
    // so the user doesn't walk through the config form again just to reach Connect.
    initialAuthTarget?: { oauth?: OAuthTarget; managed?: ManagedTarget; composio?: ComposioTarget; app?: AppTarget }
    // Called after a successful install/connect — e.g. to auto-send a chat follow-up so the
    // agent continues with the new tools available.
    onInstalled?: (key: string, name: string) => void
    // Connects at mount, for a caller whose own Connect button already was the user's click.
    // The popup is the one it opened inside that click handler.
    autoConnect?: { popup: Window | null }
    // Set up in the Vault: the driver answers with the entry's id as the key, and a sign-in lands on
    // that entry rather than on a coworker.
    vault?: boolean
}

type AuthTarget = NonNullable<ServiceConfigFormProps['initialAuthTarget']>

type OAuthStep = { serverName: string; url: string }
type ManagedStep = { provider: string; serverName: string }
type ComposioStep = { toolkit: string; serverName: string }

function pickDefaultMethod(methods: AuthMethodSummary[], initialMethodId?: string): AuthMethodSummary {
    return (initialMethodId ? methods.find(m => m.id === initialMethodId) : undefined) ?? methods.find(m => m.recommended) ?? methods[0]
}

function isConnectKind(kind: AuthMethodSummary['kind']): boolean {
    return kind === 'oauth' || kind === 'managed' || kind === 'composio'
}

function hasSignInTarget(target: AuthTarget | undefined): boolean {
    return Boolean(target?.oauth || target?.managed || target?.composio)
}

// Nothing to pick and nothing to type: the only thing left between the user and the sign-in
// popup is a click, so the caller's own Connect button can be that click.
export function connectsInOneClick(authMethods: AuthMethodSummary[], initialMethodId?: string, initialAuthTarget?: AuthTarget): boolean {
    if (hasSignInTarget(initialAuthTarget)) return true
    if (authMethods.length === 0 || (authMethods.length > 1 && !initialMethodId)) return false
    const method = pickDefaultMethod(authMethods, initialMethodId)
    return isConnectKind(method.kind) && !method.inputs.some(i => !i.secret)
}

// One install form, rendered identically inline in chat AND in the Services settings tab.
// When a service offers several auth methods, a picker swaps the fields; submitting compiles
// the selected method into engine primitives. OAuth methods surface an inline sign-in step,
// so the form handles both credential and browser-sign-in flows end-to-end.
export function ServiceConfigForm({ agentId, slug, instanceKey, newInstance, name, authMethods, initialMethodId, initialAuthTarget, onInstalled, autoConnect, vault }: ServiceConfigFormProps) {
    const t = useTranslations('services')
    const errorText = useErrorText()
    const driver = useServiceSetupDriver()
    // Null until the install allocated the new account's key, so a retry reuses it.
    const [activeKey, setActiveKey] = useState<string | null>(() => (newInstance ? null : (instanceKey ?? slug)))
    const [methodId, setMethodId] = useState(() => pickDefaultMethod(authMethods, initialMethodId).id)
    const method = useMemo(() => authMethods.find(m => m.id === methodId) ?? authMethods[0], [authMethods, methodId])
    const hasChoice = authMethods.length > 1
    // A method already used by a previous install opens straight on its view; otherwise the user
    // picks one first.
    const [choosing, setChoosing] = useState(() => hasChoice && !initialMethodId)

    const form = useForm<Record<string, string>>({ defaultValues: Object.fromEntries(method.inputs.map(i => [i.key, ''])) })
    const values = form.watch()
    const [installed, setInstalled] = useState(false)
    const [authStep, setAuthStep] = useState<OAuthStep | null>(() => initialAuthTarget?.oauth ?? null)
    const [managedStep, setManagedStep] = useState<ManagedStep | null>(() => initialAuthTarget?.managed ?? null)
    const [composioStep, setComposioStep] = useState<ComposioStep | null>(() => initialAuthTarget?.composio ?? null)
    const [appStep, setAppStep] = useState<AppSlug | null>(() => {
        const initialApp = initialAuthTarget?.app?.appSlug
        return isAppSlug(initialApp) ? initialApp : null
    })
    const [signInStart, setSignInStart] = useState<{ popup: Window | null } | null>(() => (autoConnect && hasSignInTarget(initialAuthTarget) ? autoConnect : null))
    const [error, setError] = useState<string | null>(null)

    // Reset the form to the newly selected method's fields when the method changes. Skipped on
    // the first render, which would otherwise wipe an initialAuthTarget before it ever shows.
    const mountedMethodId = useRef(method.id)
    useEffect(() => {
        if (mountedMethodId.current === method.id) return
        mountedMethodId.current = method.id
        form.reset(Object.fromEntries(method.inputs.map(i => [i.key, ''])))
        setAuthStep(null)
        setManagedStep(null)
        setComposioStep(null)
        setAppStep(null)
        setSignInStart(null)
        setError(null)
    }, [method, form])

    const isConnect = isConnectKind(method.kind)
    // Connect methods get their secret from the sign-in flow, but may still need non-secret
    // pre-auth config (e.g. a data region the compiler needs to pick the host).
    const visibleInputs = isConnect ? method.inputs.filter(i => !i.secret) : method.inputs
    const missingRequired = visibleInputs.some(i => i.required && !(values[i.key] ?? '').trim())

    const unmountedRef = useRef(false)
    useEffect(() => {
        unmountedRef.current = false
        return () => {
            unmountedRef.current = true
        }
    }, [])

    const install = async (vals: Record<string, string>, popup: Window | null) => {
        setError(null)
        const res = await driver.install(agentId, activeKey ?? slug, vals, method.id, activeKey ? undefined : { newInstance: true })
        const key = res.ok ? res.result.key : (activeKey ?? slug)
        if (res.ok) setActiveKey(key)
        // Cancelled while the engine was answering: no sign-in step left to hand the popup to.
        if (unmountedRef.current) {
            popup?.close()
            return
        }
        if (res.ok && res.result.status === 'needs_auth' && res.result.app && isAppSlug(res.result.app.appSlug)) {
            popup?.close()
            setAppStep(res.result.app.appSlug)
            return
        }
        if (res.ok && res.result.status === 'needs_auth' && (res.result.managed || res.result.composio || res.result.oauth)) {
            setSignInStart({ popup })
            if (res.result.managed) setManagedStep({ provider: res.result.managed.provider, serverName: res.result.managed.serverName })
            else if (res.result.composio) setComposioStep({ toolkit: res.result.composio.toolkit, serverName: res.result.composio.serverName })
            else if (res.result.oauth) setAuthStep({ serverName: res.result.oauth.serverName, url: res.result.oauth.url })
            return
        }
        popup?.close()
        if (!res.ok) {
            setError(errorText(res))
            return
        }
        if (res.result.status === 'installed') {
            setInstalled(true)
            onInstalled?.(key, name)
            return
        }
        setError(res.result.status === 'needs_auth' ? t('configForm.noTarget') : t('configForm.missingFields'))
    }
    const submit = form.handleSubmit(vals => install(vals, null))
    const connect = (popup: Window | null) => form.handleSubmit(vals => install(vals, popup))()

    const autoConnectedRef = useRef(false)
    useEffect(() => {
        if (!autoConnect || autoConnectedRef.current || hasSignInTarget(initialAuthTarget)) return
        autoConnectedRef.current = true
        connect(autoConnect.popup)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const loading = form.formState.isSubmitting
    const connectKey = activeKey ?? slug

    if (installed) {
        return (
            <p className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2Icon className="size-4 shrink-0 text-emerald-400" />
                {t('configForm.configured', { name })}
            </p>
        )
    }

    if (authStep) {
        return (
            <div className="space-y-3">
                <p className="text-sm font-medium">
                    {t('configForm.connectTitle', { name })}
                </p>
                <p className="text-xs text-muted-foreground">{t('configForm.signInOAuth', { name })}</p>
                <McpOAuthAuthorize
                    url={authStep.url}
                    agentId={agentId}
                    serverName={authStep.serverName}
                    serviceKey={connectKey}
                    vaultItemId={vault ? connectKey : undefined}
                    autoStart={signInStart !== null}
                    pendingPopup={signInStart?.popup}
                    onAuthorized={async () => {
                        await driver.markAuthorized(agentId, connectKey)
                        setInstalled(true)
                        onInstalled?.(connectKey, name)
                    }}
                />
            </div>
        )
    }

    if (appStep) {
        return (
            <AppAccountPicker
                slug={appStep}
                title={t('configForm.setUp', { name })}
                agentId={agentId}
                onAuthorized={() => {
                    setInstalled(true)
                    onInstalled?.(connectKey, name)
                }}
            />
        )
    }

    if (composioStep) {
        return (
            <div className="space-y-3">
                <p className="text-sm font-medium">
                    {t('configForm.connectTitle', { name })}
                </p>
                <p className="text-xs text-muted-foreground">{t('configForm.signInManaged', { name })}</p>
                <ComposioConnect
                    autoStart={signInStart !== null}
                    pendingPopup={signInStart?.popup}
                    agentId={agentId}
                    instanceKey={connectKey}
                    name={name}
                    onAuthorized={() => {
                        setInstalled(true)
                        onInstalled?.(connectKey, name)
                    }}
                />
            </div>
        )
    }

    if (managedStep) {
        return (
            <div className="space-y-3">
                <p className="text-sm font-medium">
                    {t('configForm.connectTitle', { name })}
                </p>
                <p className="text-xs text-muted-foreground">{t('configForm.signInManaged', { name })}</p>
                <ManagedConnect
                    autoStart={signInStart !== null}
                    pendingPopup={signInStart?.popup}
                    agentId={agentId}
                    instanceKey={connectKey}
                    provider={managedStep.provider}
                    serverName={managedStep.serverName}
                    name={name}
                    onAuthorized={() => {
                        setInstalled(true)
                        onInstalled?.(connectKey, name)
                    }}
                />
            </div>
        )
    }

    return (
        <PanelSteps stepKey={choosing ? 'methods' : method.id} depth={choosing ? 0 : 1}>
            {choosing ? (
                <div className="space-y-3">
                    <p className="text-sm font-medium">{t('configForm.authentication')}</p>
                    <AuthMethodPicker
                        methods={authMethods}
                        onSelect={id => {
                            setMethodId(id)
                            setChoosing(false)
                        }}
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    {hasChoice ? (
                        <div className="flex items-center gap-1">
                            <Button size="icon-sm" variant="ghost" onClick={() => setChoosing(true)} aria-label={t('configForm.backToMethods')} className="-my-1 -ml-1.5 text-muted-foreground">
                                <ArrowLeftIcon className="size-4" />
                            </Button>
                            <p className="min-w-0 truncate text-sm font-medium">{method.label || t(`authMethod.label.${methodKindKey(method.kind)}`)}</p>
                        </div>
                    ) : (
                        <p className="text-sm font-medium">{t('configForm.authentication')}</p>
                    )}

                    {visibleInputs.length > 0 && <ServiceFields inputs={visibleInputs} values={values} onChange={(key, v) => form.setValue(key, v)} />}

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    {isConnect ? (
                        <Button variant="outline" size="sm" disabled={loading || missingRequired} onClick={() => connect(openPendingSignInPopup(name, t('signInPopup.connecting', { name })))} className="w-full">
                            {loading ? <Loader2Icon className="size-3.5 animate-spin mr-1.5" /> : <ExternalLinkIcon className="size-3.5 mr-1.5" />}
                            {loading ? t('configForm.connecting') : t('configForm.connect')}
                        </Button>
                    ) : (
                        <div className="flex justify-end">
                            <Button size="sm" disabled={loading || missingRequired} onClick={submit}>
                                {loading ? t('configForm.installing') : method.kind === 'app' ? t('configForm.chooseAccount') : t('configForm.install')}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </PanelSteps>
    )
}
