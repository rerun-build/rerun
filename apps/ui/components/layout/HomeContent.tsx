'use client'

import { confirmTemplatePurchaseAction } from '@moldwright/cloud/marketplace.client'
import { AppLoader } from '@/components/layout/AppLoader'
import { AuthDialog } from '@/components/dialogs/AuthDialog'
import { EngineWaitlistDialog } from '@/components/dialogs/EngineWaitlistDialog'
import { BuilderView } from '@/components/builder/BuilderView'
import { ForemanDock } from '@/components/foreman/ForemanDock'
import { useRewindEnabled } from '@/components/layout/FeatureFlagsProvider'
import { PhoneVerificationDialog } from '@moldwright/cloud/phone.client'
import { PostPaymentDialog, TemplatePurchaseSuccessDialog } from '@moldwright/cloud/billing.client'
import { AgentShareDeepLinkDialog } from '@/components/dialogs/AgentShareDeepLinkDialog'
import { TemplateDeepLinkDialog } from '@/components/dialogs/TemplateDeepLinkDialog'
import { WorkspacePausedBanner } from '@/components/layout/WorkspacePausedBanner'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ChangelogDialog } from '@/components/changelog/ChangelogDialog'
import { ControlCenter } from '@/components/control-center/ControlCenter'
import { RewindViewer, useRewindLauncher, useRewindStore } from '@moldwright/cloud/rewind.client'
import { useChangelogLauncher } from '@/components/changelog/useChangelogLauncher'
import { useEnsureSandboxSpace } from '@/lib/sandbox/useEnsureSandboxSpace'
import { useAgentHealthSync } from '@/hooks/useAgentHealthSync'
import { useAgentSchedulesSync } from '@/hooks/useAgentSchedulesSync'
import { useNotificationsRealtime } from '@/hooks/useNotificationsRealtime'
import { useSessionsRealtime } from '@/hooks/useSessionsRealtime'
import { useSpaceAccessSync } from '@/hooks/useSpaceAccessSync'
import { useSpacesRealtime } from '@/hooks/useSpacesRealtime'
import { useUnseenRunsSync } from '@/hooks/useUnseenRunsSync'
import { useAccountStore } from '@/stores/account.store'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useCreatorStore } from '@/stores/creator.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useAgentsRealtime } from '@/supabase/useAgentsRealtime'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useAgentShareStore } from '@/stores/agent-share.store'
import { useTemplateFlowStore } from '@/stores/template-flow.store'
import { selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useResumePendingStart } from '@/lib/onboarding/useResumePendingStart'
import { openConversationFromNotification } from '@/lib/notifications/open-conversation'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AGENT_FOCUS_TABS, type AgentFocusTab, type SpacePublic } from '@/lib/board/types'
import { useSearchParams } from 'next/navigation'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_LINK_ERROR_PARAM, ACCOUNT_LINK_PROVIDER_PARAM, ACCOUNT_PARAM, linkErrorMessage } from '@/lib/auth/link-intent'
import { OAUTH_PROVIDER_CONFIG, isOAuthProvider, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { oauthErrorCode, oauthRetryCopy, withoutOAuthError } from '@/lib/auth/oauth-error'
import { oauthProviderLeftFor } from '@/lib/auth/oauth-sign-in'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { track } from '@moldwright/analytics/client'

const MIN_LOADER_MS = 1300

function clearSearchParams(...keys: string[]) {
    const url = new URL(window.location.href)
    if (!keys.some(key => url.searchParams.has(key))) return
    for (const key of keys) url.searchParams.delete(key)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function clearTemplateParam() {
    clearSearchParams('template')
}

export function HomeContent({ initialSpaces = [], initialWorkspaceId = null }: { initialSpaces?: SpacePublic[]; initialWorkspaceId?: number | null }) {
    const t = useTranslations('layout')
    const tOAuthRetry = useTranslations('auth.oauthRetry')
    const tLinkError = useTranslations('account.signIn.linkError')
    const { user, workspace, loading, isAnonymous, phoneStep } = useSession()
    const foremanVisible = useForemanStore(selectForemanVisible)
    const foremanFunnel = useForemanStore(state => state.funnel)
    const foremanIntake = useForemanStore(state => state.intake)
    const foremanOpen = useForemanStore(state => state.open)
    const foremanArrival = useForemanStore(state => state.arrival)
    const foremanWaitlisted = useForemanStore(state => state.waitlisted)
    const pendingIntake = useOnboardingStore(state => state.pendingIntake)
    const rewindEnabled = useRewindEnabled()
    const resumePendingStart = useResumePendingStart()
    const searchParams = useSearchParams()
    const [postPaymentOpen, setPostPaymentOpen] = useState(false)
    const [accountClaimed, setAccountClaimed] = useState(false)
    const [signInRetry, setSignInRetry] = useState<{ code: string; provider: OAuthProvider | null } | null>(null)
    const foremanHoldsTheWall = foremanFunnel === 'unknown' || (foremanFunnel === 'guided' && (foremanIntake ? foremanOpen !== false : pendingIntake !== null))
    const readyMadeParked = useOnboardingStore(s => s.pendingTemplateLink !== null || s.pendingShareLink !== null)
    const arrivalHoldsTheWall = foremanArrival ? foremanFunnel === 'guided' && !foremanArrival.installed && foremanOpen !== false : foremanFunnel === 'unknown' && readyMadeParked && !workspace?.onboarded_at
    const accountWallOpen = isAnonymous && !accountClaimed && !foremanHoldsTheWall && !arrivalHoldsTheWall
    const retryCopy = signInRetry ? oauthRetryCopy(signInRetry.code, signInRetry.provider ? OAUTH_PROVIDER_CONFIG[signInRetry.provider].label : null, tOAuthRetry) : null
    const phoneWallOpen = phoneStep === 'pending' && !arrivalHoldsTheWall
    const templateLinkSlug = useTemplateFlowStore(s => s.linkSlug)
    const shareLinkToken = useAgentShareStore(s => s.token)
    const purchase = useTemplateFlowStore(s => s.purchase)
    const hydrated = useBoardStore(s => s.hydrated)
    const hydrate = useBoardStore(s => s.hydrate)
    const selectedAgentWorking = useBoardStore(s =>
        s.selectedAgentId !== null &&
        s.agents.some(a => a.id === s.selectedAgentId && a.status === 'working')
    )

    const [holdLoader, setHoldLoader] = useState(loading)
    useEffect(() => {
        if (!holdLoader) return
        const t = setTimeout(() => setHoldLoader(false), MIN_LOADER_MS)
        return () => clearTimeout(t)
    }, [holdLoader])

    const hydratedWorkspaceId = useRef<number | null>(null)
    useEffect(() => {
        if (!workspace) return
        if (hydratedWorkspaceId.current === workspace.id) return
        hydratedWorkspaceId.current = workspace.id
        useBoardStore.getState().reset()
        hydrate(workspace.id)
    }, [workspace, hydrate])

    useEffect(() => {
        if (searchParams.get('billing') !== 'success') return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (hasPendingStart(useOnboardingStore.getState())) setPostPaymentOpen(true)
        clearSearchParams('billing')
    }, [searchParams])

    useEffect(() => {
        if (loading) return
        clearSearchParams(WORKSPACE_PARAM)
    }, [loading])

    useEffect(() => {
        if (searchParams.get('billing') !== '1' || loading || isAnonymous) return
        useBillingStore.getState().openBilling(undefined, 'email_link')
        clearSearchParams('billing')
    }, [searchParams, loading, isAnonymous])

    useEffect(() => {
        if (searchParams.get(ACCOUNT_PARAM) !== 'sign-in' || loading || isAnonymous) return
        const linkError = searchParams.get(ACCOUNT_LINK_ERROR_PARAM)
        const linkProvider = searchParams.get(ACCOUNT_LINK_PROVIDER_PARAM)
        useAccountStore.getState().openAccount('sign-in')
        if (linkError) toast.error(linkErrorMessage(linkError, isOAuthProvider(linkProvider) ? linkProvider : 'google', tLinkError))
        clearSearchParams(ACCOUNT_PARAM, ACCOUNT_LINK_ERROR_PARAM, ACCOUNT_LINK_PROVIDER_PARAM)
    }, [searchParams, loading, isAnonymous, tLinkError])

    useEffect(() => {
        if (loading) return
        const url = new URL(window.location.href)
        const code = oauthErrorCode(url)
        if (!code) return
        if (isAnonymous) {
            const provider = oauthProviderLeftFor()
            track('oauth_sign_in_failed', { code, provider })
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSignInRetry({ code, provider })
        }
        const clean = withoutOAuthError(url)
        window.history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`)
    }, [searchParams, loading, isAnonymous])

    useEffect(() => {
        if (searchParams.get('creator') !== 'payouts') return
        const store = useCreatorStore.getState()
        store.openCreator({ kind: 'payouts' })
        if (searchParams.get('connect') === 'refresh') store.setConnectRefresh(true)
        clearSearchParams('creator', 'connect')
    }, [searchParams])

    useEffect(() => {
        if (searchParams.get('billing') !== 'cancel') return
        const parked = useOnboardingStore.getState().pendingTemplate
        if (parked?.needsPlacement) {
            useOnboardingStore.getState().clearPendingTemplate()
            useTemplateFlowStore.getState().openLink(parked.slug)
        }
        clearSearchParams('billing')
    }, [searchParams])

    const purchaseStarted = useRef(false)
    useEffect(() => {
        const outcome = searchParams.get('purchase')
        if (!outcome || purchaseStarted.current) return
        purchaseStarted.current = true

        const slug = searchParams.get('template')
        const sessionId = searchParams.get('session_id')
        const flow = useTemplateFlowStore.getState()
        if (useOnboardingStore.getState().pendingTemplateLink === slug) {
            if (outcome === 'cancel') toast(t('purchaseCancelled'))
            else if (sessionId) void confirmTemplatePurchaseAction(sessionId)
            clearSearchParams('purchase', 'template', 'session_id')
            return
        }
        if (outcome === 'cancel') {
            toast(t('purchaseCancelled'))
            if (slug) flow.openLink(slug)
        } else if (slug) {
            flow.openPurchase({ slug, sessionId })
        }
        clearSearchParams('purchase', 'template', 'session_id')
    }, [searchParams, t])

    const templateLinkStarted = useRef(false)
    useEffect(() => {
        const slug = searchParams.get('template') ?? useOnboardingStore.getState().pendingTemplateLink
        if (!slug || searchParams.has('purchase') || templateLinkStarted.current || !workspace || !user) return
        if (isAnonymous || foremanWaitlisted || (!workspace.onboarded_at && !workspace.is_sandbox)) {
            useOnboardingStore.getState().setPendingTemplateLink(slug)
            clearTemplateParam()
            return
        }
        if (foremanFunnel !== 'companion') return
        templateLinkStarted.current = true
        useOnboardingStore.getState().clearPendingTemplateLink()
        useTemplateFlowStore.getState().openLink(slug)
        clearTemplateParam()
    }, [searchParams, user, workspace, isAnonymous, foremanFunnel, foremanWaitlisted])

    const shareLinkStarted = useRef(false)
    useEffect(() => {
        const token = searchParams.get('share') ?? useOnboardingStore.getState().pendingShareLink
        if (!token || shareLinkStarted.current || !workspace || !user) return
        if (foremanWaitlisted && !isAnonymous) {
            useAgentShareStore.getState().closeLink()
            useOnboardingStore.getState().setPendingShareLink(token)
            clearSearchParams('share')
            return
        }
        if (isAnonymous || (!workspace.onboarded_at && !workspace.is_sandbox)) {
            useOnboardingStore.getState().setPendingShareLink(token)
            clearSearchParams('share')
            return
        }
        useAgentShareStore.getState().openLink(token)
        shareLinkStarted.current = true
        useOnboardingStore.getState().clearPendingShareLink()
        clearSearchParams('share')
    }, [searchParams, user, workspace, isAnonymous, foremanWaitlisted])

    const agentLinkOpened = useRef(false)
    useEffect(() => {
        const agentId = searchParams.get('agent')
        if (!agentId || agentLinkOpened.current || !hydrated || isAnonymous) return
        agentLinkOpened.current = true
        const tab = searchParams.get('tab')
        useBoardStore.getState().openAgentTab(agentId, AGENT_FOCUS_TABS.includes(tab as AgentFocusTab) ? (tab as AgentFocusTab) : 'chat')
        clearSearchParams('agent', 'tab')
    }, [searchParams, hydrated, isAnonymous])

    const notificationLinkOpened = useRef(false)
    useEffect(() => {
        const notificationId = searchParams.get('notification')
        if (!notificationId || notificationLinkOpened.current || !hydrated || isAnonymous) return
        notificationLinkOpened.current = true
        clearSearchParams('notification')
        void selectMaybeSingle(createClient(), 'notifications', ['agent_id', 'engine_session_id', 'engine_run_id'] as const, { id: notificationId }).then(({ data }) => {
            if (!data) return
            void openConversationFromNotification({ agentId: data.agent_id, engineSessionId: data.engine_session_id, engineRunId: data.engine_run_id })
        })
    }, [searchParams, hydrated, isAnonymous])

    useEffect(() => {
        if (!templateLinkStarted.current || !searchParams.get('template')) return
        clearTemplateParam()
    }, [searchParams])

    useEffect(() => {
        if (loading || !workspace || phoneStep !== 'clear') return
        if (!hasPendingStart(useOnboardingStore.getState())) return
        const foremanTakesOver = useOnboardingStore.getState().firstAgentFromPrompt && !workspace.onboarded_at
        if (!useOnboardingStore.getState().consumeResume()) return
        if (foremanTakesOver) return
        void resumePendingStart()
    }, [loading, workspace, phoneStep, resumePendingStart])

    useEffect(() => {
        if (loading || !workspace || !hydrated) return
        void useBoardStore
            .getState()
            .sendPendingKickoff()
            .then(sent => {
                if (sent) useBoardStore.getState().selectAgent(sent.agentId)
            })
    }, [loading, workspace, hydrated])

    useEffect(() => {
        if (!selectedAgentWorking) return
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [selectedAgentWorking])

    const rewindDeepLinked = searchParams.has('rewind')
    const rewindReady = rewindEnabled && hydrated && !isAnonymous && Boolean(workspace?.onboarded_at) && !templateLinkSlug && !shareLinkToken && !purchase
    useRewindLauncher(workspace?.id, rewindReady, rewindDeepLinked)
    useEffect(() => {
        if (rewindDeepLinked && (rewindReady || !rewindEnabled)) clearSearchParams('rewind')
    }, [rewindReady, rewindDeepLinked, rewindEnabled])

    const rewindShown = useRewindStore(state => state.shown !== null)
    const changelogReady = hydrated && !accountWallOpen && !phoneWallOpen && !isAnonymous && Boolean(workspace?.onboarded_at) && !templateLinkSlug && !shareLinkToken && !purchase && !rewindShown
    useChangelogLauncher(user?.id, changelogReady)

    useEnsureSandboxSpace()
    useAgentHealthSync(hydrated ? workspace?.id : undefined)
    useAgentSchedulesSync(hydrated ? workspace?.id : undefined)
    useAgentsRealtime(hydrated ? workspace?.id : undefined)
    useSpacesRealtime(hydrated ? workspace?.id : undefined)
    useSpaceAccessSync(hydrated ? workspace?.id : undefined)
    useSessionsRealtime(hydrated)
    useNotificationsRealtime(hydrated ? workspace?.id : undefined)
    useUnseenRunsSync(hydrated ? workspace?.id : undefined, user?.id)

    const serverBoardMatchesTab = initialWorkspaceId === workspace?.id

    if (loading || holdLoader || (!serverBoardMatchesTab && !hydrated)) {
        return <AppLoader />
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            <main className="flex-1 relative overflow-hidden">
                <BuilderView initialSpaces={serverBoardMatchesTab ? initialSpaces : []} />
                <WorkspaceSwitcher />
                <WorkspacePausedBanner />
            </main>
            {foremanVisible && <ForemanDock />}
            <AuthDialog variant="welcome" open={accountWallOpen} onOpenChange={() => setAccountClaimed(true)} copy={retryCopy} />
            {!accountWallOpen && <AuthDialog variant="signin" open={signInRetry !== null && isAnonymous} onOpenChange={open => !open && setSignInRetry(null)} copy={retryCopy} />}
            <PhoneVerificationDialog open={phoneWallOpen} />
            <EngineWaitlistDialog open={foremanWaitlisted && !isAnonymous} />
            <PostPaymentDialog open={postPaymentOpen} onOpenChange={setPostPaymentOpen} />
            {purchase && <TemplatePurchaseSuccessDialog slug={purchase.slug} sessionId={purchase.sessionId} onOpenChange={open => !open && useTemplateFlowStore.getState().closePurchase()} />}
            {templateLinkSlug && <TemplateDeepLinkDialog slug={templateLinkSlug} />}
            {shareLinkToken && <AgentShareDeepLinkDialog token={shareLinkToken} />}
            {rewindEnabled && <RewindViewer />}
            <ChangelogDialog />
            <ControlCenter />
        </div>
    )
}
