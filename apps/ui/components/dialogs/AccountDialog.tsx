'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { resendLiveSignInCode } from '@/app/(authflow)/auth/actions'
import {
    deleteMyAccountAction,
    getAccountDeletionStatusAction,
    getSignInMethodsAction,
    prepareEmailChangeAction,
    removeMyAvatarAction,
    syncAccountEmailAction,
    updateMyNameAction,
    uploadMyAvatarAction,
    type SignInMethods,
} from '@/app/api/_actions/account.actions'
import type { ActionResult } from '@/app/api/_actions/space.actions'
import { AccountTabs, useAccountTabText } from '@/components/account/AccountTabs'
import { DeleteAccountPanel } from '@/components/account/DeleteAccountPanel'
import { LanguagePanel } from '@/components/account/LanguagePanel'
import { useLanguageChoice } from '@/components/account/useLanguageChoice'
import { ProfilePanel } from '@/components/account/ProfilePanel'
import { SignInMethodsPanel } from '@/components/account/SignInMethodsPanel'
import { EmailCodeForm } from '@/components/auth/EmailCodeForm'
import { DIALOG_TABS_CONTENT, DIALOG_TABS_HEADER } from '@/components/dialogs/DialogTabs'
import { useLanguagePacksEnabled } from '@/components/layout/FeatureFlagsProvider'
import { PHONE_ENABLED } from '@rerun/cloud/phone'
import { PhoneChangeForm } from '@rerun/cloud/phone.client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PanelEditorBody, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { PanelSteps } from '@/components/ui/panel-steps'
import type { AccountDeletionBlocker } from '@/lib/auth/account-deletion'
import { forgetLinkIntent, rememberLinkIntent } from '@/lib/auth/link-intent'
import { OAUTH_PROVIDER_CONFIG, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { realEmail } from '@/lib/auth/placeholder-email'
import { readProfile } from '@/lib/auth/user-profile'
import { detectInAppBrowser } from '@/lib/in-app-browser'
import { routes } from '@/lib/routes'
import { useAccountStore, type AccountTab } from '@/stores/account.store'
import { useBillingStore } from '@/stores/billing.store'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DesktopAppPanel } from '@/components/account/DesktopAppPanel'
import { desktopShell } from '@/lib/desktop-shell/client'
import { toast } from 'sonner'

const noSubscription = () => () => {}

function unwrap(result: ActionResult, errorText: ReturnType<typeof useErrorText>) {
    if (!result.ok) throw new Error(errorText(result))
}

// The name and the photo ride on the session's user, so reading them back is a token refresh.
async function refreshSession() {
    await createClient().auth.refreshSession()
}

function ProfileTab() {
    const { session } = useSession()
    const errorText = useErrorText()
    const authUser = session?.user
    if (!authUser) return null
    const profile = readProfile(authUser)

    const uploadAvatar = async (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        unwrap(await uploadMyAvatarAction(formData), errorText)
        await refreshSession()
    }

    const removeAvatar = async () => {
        unwrap(await removeMyAvatarAction(), errorText)
        await refreshSession()
    }

    const saveName = async (name: string) => {
        unwrap(await updateMyNameAction({ name }), errorText)
        await refreshSession()
    }

    return <ProfilePanel name={profile.name ?? ''} avatarUrl={profile.avatarUrl} fallbackLabel={realEmail(authUser.email)} uploadAvatar={uploadAvatar} removeAvatar={removeAvatar} saveName={saveName} />
}

type SignInStep = 'list' | 'email' | 'phone'

function SignInTab() {
    const t = useTranslations('dialogs.account')
    const errorText = useErrorText()
    const { refreshPhoneStep } = useSession()
    const [methods, setMethods] = useState<SignInMethods | null>(null)
    const [step, setStep] = useState<SignInStep>(() => useAccountStore.getState().signInStart)
    const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null)
    const [inAppBrowser] = useState(() => !!detectInAppBrowser(navigator.userAgent))

    const show = (result: Awaited<ReturnType<typeof getSignInMethodsAction>>) => {
        if (result.ok) setMethods(result.methods)
        else toast.error(errorText(result))
    }
    const load = async () => show(await getSignInMethodsAction())

    useEffect(() => {
        let mounted = true
        void getSignInMethodsAction().then(result => {
            if (mounted) show(result)
        })
        return () => {
            mounted = false
        }
    }, [])

    const backToList = async () => {
        await load()
        setStep('list')
    }

    const sendEmailCode = async (email: string) => {
        unwrap(await prepareEmailChangeAction({ email }), errorText)
        const live = await resendLiveSignInCode(email)
        if (live.resent) return live.held ? 'held' : undefined
        const { error } = await createClient().auth.updateUser({ email })
        if (error) throw error
    }

    const verifyEmailCode = async (email: string, code: string) => {
        const { data, error } = await createClient().auth.verifyOtp({ email, token: code, type: 'email_change' })
        if (error) throw error
        // Supabase answers a success while the change still waits on the current address, which is
        // how a project left on double confirmation behaves.
        if (data.user?.email?.toLowerCase() !== email) throw new Error(t('emailChangeNeedsCurrentAddress'))
        void syncAccountEmailAction()
        toast.success(t('emailUpdated'))
        await backToList()
    }

    const onPhoneChanged = async () => {
        // An account born from a number is filed under it, so its address just moved with it.
        await Promise.all([refreshSession(), refreshPhoneStep()])
        toast.success(t('phoneUpdated'))
        await backToList()
    }

    // Never the fallback of the sign-in button: a plain sign-in from here would leave this account
    // for another one.
    const connectProvider = async (provider: OAuthProvider) => {
        const { label, queryParams } = OAUTH_PROVIDER_CONFIG[provider]
        setBusyProvider(provider)
        rememberLinkIntent(provider)
        const { error } = await createClient().auth.linkIdentity({ provider, options: { redirectTo: `${window.location.origin}${routes.authCallback}`, queryParams } })
        if (!error) return
        forgetLinkIntent()
        setBusyProvider(null)
        toast.error(t('connectFailed', { provider: label }))
    }

    const disconnectProvider = async (provider: OAuthProvider) => {
        const { label } = OAUTH_PROVIDER_CONFIG[provider]
        const failure = t('disconnectFailed', { provider: label })
        setBusyProvider(provider)
        try {
            const supabase = createClient()
            const { data, error: readError } = await supabase.auth.getUserIdentities()
            const identity = data?.identities.find(candidate => candidate.provider === provider)
            if (readError || !identity) throw new Error(failure)
            const { error } = await supabase.auth.unlinkIdentity(identity)
            if (error) throw new Error(error.code === 'single_identity_not_deletable' ? t('onlySignInMethod', { provider: label }) : failure)
            await refreshSession()
            toast.success(t('disconnected', { provider: label }))
            await load()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : failure)
        } finally {
            setBusyProvider(null)
        }
    }

    if (step === 'email') {
        return (
            <PanelSteps stepKey="email" depth={1}>
                <PanelEditorShell>
                    <PanelEditorHeader title={methods?.email ? t('changeEmail') : t('addEmail')} onBack={() => setStep('list')} />
                    <PanelEditorBody>
                        <div className="mx-auto w-full max-w-sm py-4">
                            <EmailCodeForm purpose="change" sendCode={sendEmailCode} verifyCode={verifyEmailCode} />
                        </div>
                    </PanelEditorBody>
                </PanelEditorShell>
            </PanelSteps>
        )
    }

    if (step === 'phone') {
        return (
            <PanelSteps stepKey="phone" depth={1}>
                <PanelEditorShell>
                    <PanelEditorHeader title={methods?.phone ? t('changePhone') : t('addPhone')} onBack={() => setStep('list')} />
                    <PanelEditorBody>
                        <div className="mx-auto w-full max-w-sm py-4">
                            <PhoneChangeForm onChanged={onPhoneChanged} />
                        </div>
                    </PanelEditorBody>
                </PanelEditorShell>
            </PanelSteps>
        )
    }

    return (
        <PanelSteps stepKey="list" depth={0}>
            <SignInMethodsPanel
                methods={methods}
                unavailableReasons={inAppBrowser ? { google: t('googleNeedsBrowser') } : undefined}
                busyProvider={busyProvider}
                onChangeEmail={() => setStep('email')}
                onChangePhone={PHONE_ENABLED ? () => setStep('phone') : undefined}
                onConnect={connectProvider}
                onDisconnect={disconnectProvider}
            />
        </PanelSteps>
    )
}

function DeleteAccountTab() {
    const { workspace, signOut } = useSession()
    const errorText = useErrorText()
    const setOpen = useAccountStore(state => state.setOpen)
    const openBilling = useBillingStore(state => state.openBilling)
    const [blockers, setBlockers] = useState<AccountDeletionBlocker[] | null>(null)

    useEffect(() => {
        let mounted = true
        void getAccountDeletionStatusAction().then(result => {
            if (!mounted) return
            if (result.ok) setBlockers(result.blockers)
            else toast.error(errorText(result))
        })
        return () => {
            mounted = false
        }
    }, [])

    const openBillingPanel = () => {
        setOpen(false)
        openBilling()
    }

    const deleteAccount = async (confirmation: string) => {
        unwrap(await deleteMyAccountAction({ confirmation }), errorText)
        setOpen(false)
        await signOut()
    }

    return <DeleteAccountPanel blockers={blockers} currentWorkspaceId={workspace?.id ?? null} onOpenBilling={openBillingPanel} deleteAccount={deleteAccount} />
}

function LanguageTab() {
    const { value, change } = useLanguageChoice()
    return <LanguagePanel value={value} onChange={change} />
}

const TAB_CONTENT: Record<AccountTab, () => ReactNode> = {
    profile: ProfileTab,
    'sign-in': SignInTab,
    language: LanguageTab,
    desktop: DesktopAppPanel,
    delete: DeleteAccountTab,
}

export function AccountDialog() {
    const { open, tab: requestedTab, setOpen, setTab } = useAccountStore()
    const t = useTranslations('account')
    const showLanguage = useLanguagePacksEnabled()
    const showDesktop = useSyncExternalStore(noSubscription, () => desktopShell('settings') !== null, () => false)
    const tab = (requestedTab === 'language' && !showLanguage) || (requestedTab === 'desktop' && !showDesktop) ? 'profile' : requestedTab
    const { description } = useAccountTabText(tab)
    const TabContent = TAB_CONTENT[tab]

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className={DIALOG_TABS_CONTENT}>
                <AccountTabs
                    tab={tab}
                    onTabChange={setTab}
                    showLanguage={showLanguage}
                    showDesktop={showDesktop}
                    header={
                        <DialogHeader className={DIALOG_TABS_HEADER}>
                            <DialogTitle>{t('title')}</DialogTitle>
                            <DialogDescription>{description}</DialogDescription>
                        </DialogHeader>
                    }
                >
                    <TabContent />
                </AccountTabs>
            </DialogContent>
        </Dialog>
    )
}
