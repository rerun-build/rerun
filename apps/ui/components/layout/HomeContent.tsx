'use client'

import { confirmTemplatePurchaseAction } from '@rerun/cloud/marketplace.client'
import { AppLoader } from '@/components/layout/AppLoader'
import { AuthDialog } from '@/components/dialogs/AuthDialog'
import { EngineWaitlistDialog } from '@/components/dialogs/EngineWaitlistDialog'
import { BuilderView } from '@/components/builder/BuilderView'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { SimplePhoneHome } from '@/components/workspace-view/SimplePhoneHome'
import { SimpleWorkspace } from '@/components/workspace-view/SimpleWorkspace'
import { useWorkspaceView } from '@/components/workspace-view/WorkspaceViewProvider'
import { FOREMAN_COLUMN_QUERY } from '@/lib/foreman-open'
import { useResolvedIsMobile } from '@rerun/ui/primitives'
import { ForemanDock } from '@/components/foreman/ForemanDock'
import { PhoneVerificationDialog } from '@rerun/cloud/phone.client'
import { PostPaymentDialog, TemplatePurchaseSuccessDialog } from '@rerun/cloud/billing.client'
import { AgentShareDeepLinkDialog } from '@/components/dialogs/AgentShareDeepLinkDialog'
import { TemplateDeepLinkDialog } from '@/components/dialogs/TemplateDeepLinkDialog'
import { WorkspacePausedBanner } from '@/components/layout/WorkspacePausedBanner'
import { WorkspaceDialogs } from '@/components/layout/WorkspaceDialogs'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ChangelogDialog } from '@/components/changelog/ChangelogDialog'
import { ControlCenter } from '@/components/control-center/ControlCenter'
import { useChangelogLauncher } from '@/components/changelog/useChangelogLauncher'
import { useEnsureSandboxSpace } from '@/lib/sandbox/useEnsureSandboxSpace'
import { useAgentHealthSync } from '@/hooks/useAgentHealthSync'
import { useAgentSchedulesSync } from '@/hooks/useAgentSchedulesSync'
import { useCoworkerPreviewsSync } from '@/hooks/useCoworkerPreviewsSync'
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
import { clearSearchParams } from '@/lib/clear-search-params'
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
import { track } from '@rerun/analytics/client'

// Durée minimale d'affichage du loader : le temps que le R se trace (45% d'un
// cycle de 2.8s) pour que l'animation soit perceptible et pas un simple flash.
const MIN_LOADER_MS = 1300

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
    const resumePendingStart = useResumePendingStart()
    const searchParams = useSearchParams()
    const [postPaymentOpen, setPostPaymentOpen] = useState(false)
    // Le mur ne se referme que sur un succès : la dialog bloquante n'appelle onOpenChange que là.
    // On ne peut pas se contenter de `isAnonymous`, car un signup en attente de confirmation d'email
    // laisse la session anonyme en place, et l'utilisateur resterait enfermé derrière son propre mur.
    const [accountClaimed, setAccountClaimed] = useState(false)
    const [signInRetry, setSignInRetry] = useState<{ code: string; provider: OAuthProvider | null } | null>(null)
    // Un anonyme n'est laissé devant le board que le temps de la carte d'accueil : elle ne coûte
    // aucun modèle et c'est elle qui dessine sa boîte. Une fois répondue, c'est le bouton au pied de
    // la colonne qui ouvre la dialog de compte, jamais elle qui surgit seule, même colonne refermée :
    // l'orbe la rouvre sur ce bouton. Le reste (colonne refermée pendant la carte, phase qui n'est
    // pas un tunnel) le ramène au mur.
    const foremanHoldsTheWall = foremanFunnel === 'unknown' || (foremanFunnel === 'guided' && (foremanIntake ? foremanOpen !== false : pendingIntake !== null))
    // Arrivé sur une template ou un partage : la colonne demande elle-même le compte puis le code du
    // téléphone, avec ce qu'il a cliqué sous les yeux, et les deux murs lui cèdent la place. Le lien
    // parké tient la supposition le temps que la phase revienne, sinon le mur du téléphone surgit
    // entre la création du compte et la reprise du tunnel.
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
    const { view, enabled: simpleViewEnabled } = useWorkspaceView()
    // Under `md` the Simple view is the phone's Home, the coworker's panel opening over it as on the
    // board. Unknown until the window is measured, so neither frame mounts for a frame on the wrong side.
    const phone = useResolvedIsMobile(FOREMAN_COLUMN_QUERY)
    const simple = view === 'simple' && phone === false
    const phoneHome = view === 'simple' && phone === true
    // What is created goes where the frame on screen can show it: on the grid, or into a Box of the list.
    useEffect(() => {
        useBoardStore.getState().setCreationFrame(simple || phoneHome ? 'list' : 'board')
    }, [simple, phoneHome])
    const selectedAgentWorking = useBoardStore(s =>
        s.selectedAgentId !== null &&
        s.agents.some(a => a.id === s.selectedAgentId && a.status === 'working')
    )

    // Si la session charge plus vite que l'animation du logo, l'écran de
    // chargement disparaît en un flash : on le tient un minimum de temps
    // (seulement s'il a commencé à s'afficher, pas de délai artificiel sinon).
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

    // Retour de Stripe : si on revient avec ?billing=success et qu'un brouillon d'agent attend
    // (onboarding), on propose de démarrer l'agent. On nettoie le param pour ne pas re-déclencher.
    useEffect(() => {
        if (searchParams.get('billing') !== 'success') return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (hasPendingStart(useOnboardingStore.getState())) setPostPaymentOpen(true)
        clearSearchParams('billing')
    }, [searchParams])

    // The workspace a landing named is pinned by the session once it loads: the URL has done its job.
    useEffect(() => {
        if (loading) return
        clearSearchParams(WORKSPACE_PARAM)
    }, [loading])

    // Every end-of-access email links here: open billing straight away, once the account is known.
    useEffect(() => {
        if (searchParams.get('billing') !== '1' || loading || isAnonymous) return
        useBillingStore.getState().openBilling(undefined, 'email_link')
        clearSearchParams('billing')
    }, [searchParams, loading, isAnonymous])

    // Connecting a provider from the account settings leaves the app and comes back here: the
    // settings reopen where they were left, with the reason when the connection was refused.
    useEffect(() => {
        if (searchParams.get(ACCOUNT_PARAM) !== 'sign-in' || loading || isAnonymous) return
        const linkError = searchParams.get(ACCOUNT_LINK_ERROR_PARAM)
        const linkProvider = searchParams.get(ACCOUNT_LINK_PROVIDER_PARAM)
        useAccountStore.getState().openAccount('sign-in')
        if (linkError) toast.error(linkErrorMessage(linkError, isOAuthProvider(linkProvider) ? linkProvider : 'google', tLinkError))
        clearSearchParams(ACCOUNT_PARAM, ACCOUNT_LINK_ERROR_PARAM, ACCOUNT_LINK_PROVIDER_PARAM)
    }, [searchParams, loading, isAnonymous, tLinkError])

    // A provider sign-in that failed upstream lands here with the error in the URL, where it would
    // otherwise stay for the whole session. Only someone still anonymous needs to hear about it: an
    // account already signed in got there through another tab. A toast would leave them on a screen
    // with no provider button, so the account dialog reopens and says what happened.
    useEffect(() => {
        if (loading) return
        const url = new URL(window.location.href)
        const code = oauthErrorCode(url)
        if (!code) return
        if (isAnonymous) {
            const provider = oauthProviderLeftFor()
            track('oauth_sign_in_failed', { code, provider })
            // The URL is the only place the failure lives, and this effect is what wipes it.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSignInRetry({ code, provider })
        }
        const clean = withoutOAuthError(url)
        window.history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`)
    }, [searchParams, loading, isAnonymous])

    // Retour de l'onboarding Stripe Connect d'un créateur : Stripe redirige sur la home, donc c'est
    // ici qu'on rouvre le panel créateur sur son pane payouts. `connect=refresh` signale un lien
    // expiré, que le pane consomme pour en remint un tout de suite.
    useEffect(() => {
        if (searchParams.get('creator') !== 'payouts') return
        const store = useCreatorStore.getState()
        store.openCreator({ kind: 'payouts' })
        if (searchParams.get('connect') === 'refresh') store.setConnectRefresh(true)
        clearSearchParams('creator', 'connect')
    }, [searchParams])

    // Trial abandonné depuis la fiche d'une template : rien n'a été engagé, et la template parkée
    // n'a plus rien pour revenir à l'écran. On rouvre la fiche là où l'utilisateur l'a laissée et on
    // dépark, sinon l'entrée traîne et fait passer le board pour occupé.
    useEffect(() => {
        if (searchParams.get('billing') !== 'cancel') return
        const parked = useOnboardingStore.getState().pendingTemplate
        if (parked?.needsPlacement) {
            useOnboardingStore.getState().clearPendingTemplate()
            useTemplateFlowStore.getState().openLink(parked.slug)
        }
        clearSearchParams('billing')
    }, [searchParams])

    // Retour du checkout d'une template payante. Le slug reste dans l'URL pour que la dialog sache
    // ce qui vient d'être acheté, et `session_id` ouvre la voie rapide : confirmer la session sans
    // attendre le webhook. Une annulation ramène à la fiche, là où l'utilisateur l'avait laissée,
    // plutôt qu'à un board nu avec un toast.
    const purchaseStarted = useRef(false)
    useEffect(() => {
        const outcome = searchParams.get('purchase')
        if (!outcome || purchaseStarted.current) return
        purchaseStarted.current = true

        const slug = searchParams.get('template')
        const sessionId = searchParams.get('session_id')
        const flow = useTemplateFlowStore.getState()
        // Achetée en plein tunnel d'arrivée : c'est la carte d'achat de la colonne qui attend ce
        // retour et lance l'install, la fiche et le placement à la main n'ont rien à y faire.
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

    // Lien de partage de template `?template=<slug>` : il court-circuite tout le wizard de
    // recrutement pour poser sa fiche, seule à l'écran. Le slug part dans le store AVANT que le
    // param soit nettoyé : c'est lui qui dit au board qu'un parcours d'installation tient l'écran,
    // et la moindre fenêtre entre les deux suffit à la library pour s'ouvrir par-dessus. La fiche
    // charge la template elle-même. Le ref garde l'effet contre le remontage.
    //
    // Le retour de checkout porte lui aussi `?template=`, d'où la garde sur `purchase` : sans elle
    // les deux dialogs s'empileraient.
    //
    // Tant que le visiteur n'a pas de compte, le mur d'auth est seul à l'écran : on garde le slug de
    // côté (persisté, car le retour de Google perd la query string) et l'effet rejoue tout seul dès
    // que la session est réelle.
    //
    // Un workspace jamais onboardé n'a pas encore vu la moindre explication du produit : le slug reste
    // parké et c'est le Foreman qui le reprend dans son tunnel. L'onboarding est un fait du workspace,
    // pas de l'user : un membre invité dans un workspace qui tourne voit la fiche tout de suite.
    //
    // Avec le Foreman, c'est lui qui décide : tant que la phase n'est pas revenue (`unknown`) la
    // fiche attend, et elle ne s'ouvre jamais d'elle-même pendant le tunnel. Sans cette attente,
    // l'effet rejouerait à la seconde où save_profile stampe l'onboarding et poserait la fiche
    // par-dessus une conversation en cours.
    const templateLinkStarted = useRef(false)
    useEffect(() => {
        const slug = searchParams.get('template') ?? useOnboardingStore.getState().pendingTemplateLink
        if (!slug || searchParams.has('purchase') || templateLinkStarted.current || !workspace || !user) return
        // Le mur de waitlist passe le funnel en `companion`, et la fiche s'ouvrirait par-dessus avec
        // son bouton de trial : elle reste parkée jusqu'au chargement où une machine est libre.
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

    // Lien de partage d'agent `?share=<token>` : le jumeau de `?template=`. Le token est parké dans
    // tous les cas (persisté, car le retour de Google perd la query string) et l'effet rejoue dès que
    // la session est réelle.
    const shareLinkStarted = useRef(false)
    useEffect(() => {
        const token = searchParams.get('share') ?? useOnboardingStore.getState().pendingShareLink
        if (!token || shareLinkStarted.current || !workspace || !user) return
        // Ouverte derrière le mur d'auth, la fiche serait restée par-dessus le mur de waitlist avec son
        // bouton de trial : on la referme, le token reste parké pour le chargement suivant.
        if (foremanWaitlisted && !isAnonymous) {
            useAgentShareStore.getState().closeLink()
            useOnboardingStore.getState().setPendingShareLink(token)
            clearSearchParams('share')
            return
        }
        // Un workspace jamais onboardé passe par le tunnel d'arrivée : c'est la colonne qui présente
        // le coworker partagé et l'installe, la fiche ferait doublon par-dessus.
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

    // Un email de cycle de vie pointe l'agent dont il parle. Le board doit être hydraté avant, sinon
    // la sélection porte sur un id que le store ne connaît pas encore et rien ne s'ouvre.
    const agentLinkOpened = useRef(false)
    useEffect(() => {
        const agentId = searchParams.get('agent')
        if (!agentId || agentLinkOpened.current || !hydrated || isAnonymous) return
        agentLinkOpened.current = true
        const tab = searchParams.get('tab')
        useBoardStore.getState().openAgentTab(agentId, AGENT_FOCUS_TABS.includes(tab as AgentFocusTab) ? (tab as AgentFocusTab) : 'chat')
        clearSearchParams('agent', 'tab')
    }, [searchParams, hydrated, isAnonymous])

    // A notification email opens the conversation it is about, the same way its toast does. A row
    // the user can no longer read (another workspace, deleted since) leaves the board as it is.
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

    // Le lien est consommé : le param ne doit plus rien porter, sinon un refresh (après un import
    // réussi comme après une annulation) redemande l'import. Un seul nettoyage ne suffit pas, le
    // commit router d'un server action peut atterrir après lui et remettre l'URL de départ, donc on
    // renettoie chaque fois que le param réapparaît.
    useEffect(() => {
        if (!templateLinkStarted.current || !searchParams.get('template')) return
        clearTemplateParam()
    }, [searchParams])

    // Reprise après conversion d'un compte anonyme : la session réelle est en place (nouvel email,
    // compte existant, ou Google). Si un brouillon attend et que le flag one-shot est présent, on
    // termine la création du premier agent sur le workspace désormais résolu.
    //
    // Pas tant que le téléphone n'est pas réglé : le paywall s'ouvrirait par-dessus un mur qu'on ne
    // peut pas fermer. Le flag attend, persisté, et la reprise repart dès le numéro vérifié.
    useEffect(() => {
        if (loading || !workspace || phoneStep !== 'clear') return
        if (!hasPendingStart(useOnboardingStore.getState())) return
        // Un brouillon posé par le composer de la landing chez quelqu'un qui n'a jamais vu Rerun
        // n'attend pas le paywall : c'est le Foreman qui ouvre la conversation dessus, et qui le
        // consomme. Le flag one-shot est consommé quand même, sinon il ressortirait plus tard,
        // par-dessus la conversation.
        const foremanTakesOver = useOnboardingStore.getState().firstAgentFromPrompt && !workspace.onboarded_at
        if (!useOnboardingStore.getState().consumeResume()) return
        if (foremanTakesOver) return
        void resumePendingStart()
    }, [loading, workspace, phoneStep, resumePendingStart])

    // Kickoff parqué mais jamais envoyé (reload ou crash pendant le wizard "Finish setup", ou
    // envoi précédent en échec) : on le rejoue au boot et on ouvre le panel de l'agent sur la
    // conversation démarrée. Sans entrée en localStorage, sendPendingKickoff ne fait rien.
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

    // Le changelog ne s'ouvre jamais par-dessus un parcours qui tient déjà l'écran (mur d'auth,
    // onboarding, deep link de template ou de partage). Une session restée anonyme passerait par
    // `accountWallOpen` seul, qui retombe dès que le mur est écarté.
    const changelogReady = hydrated && !accountWallOpen && !phoneWallOpen && !isAnonymous && Boolean(workspace?.onboarded_at) && !templateLinkSlug && !shareLinkToken && !purchase
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
    useCoworkerPreviewsSync(hydrated && simpleViewEnabled ? workspace?.id : undefined)

    // The page load names no workspace, so the server prefetched the stored one. A tab pinned
    // elsewhere shows neither those spaces nor an empty board in their place (the recruit
    // placeholder): it keeps the loader until the store holds its own.
    const serverBoardMatchesTab = initialWorkspaceId === workspace?.id

    if (loading || holdLoader || (!serverBoardMatchesTab && !hydrated)) {
        return <AppLoader />
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            <main className="@container/board flex-1 relative overflow-hidden">
                {simple ? (
                    <SimpleWorkspace />
                ) : phoneHome ? (
                    <>
                        <SimplePhoneHome />
                        <AgentPanel />
                        <WorkspacePausedBanner />
                    </>
                ) : (
                    <>
                        <BuilderView initialSpaces={serverBoardMatchesTab ? initialSpaces : []} />
                        <WorkspaceSwitcher />
                        <WorkspacePausedBanner />
                    </>
                )}
            </main>
            {/* Hors du `<main>` comme il est hors du cadre : l'orbe est `fixed`, sa place ne dépend
                pas de l'endroit où il est monté. Ici il reste derrière l'écran de chargement. Pas
                de machine hors onboarding, pas de Foreman. */}
            {foremanVisible && view !== 'simple' && <ForemanDock />}
            {/* Le mur d'entrée : le board reste visible derrière, mais rien n'est actionnable tant
                qu'il n'y a pas de compte. Le signup upgrade la session anonyme en place, donc le
                workspace déjà provisionné et tout ce qu'un deep link a parké lui restent attachés. */}
            <AuthDialog variant="welcome" open={accountWallOpen} onOpenChange={() => setAccountClaimed(true)} copy={retryCopy} />
            {!accountWallOpen && <AuthDialog variant="signin" open={signInRetry !== null && isAnonymous} onOpenChange={open => !open && setSignInRetry(null)} copy={retryCopy} />}
            {/* Le mur du téléphone : il prend le relais dès que le compte existe, par quelque porte
                qu'il soit né, et ne tombe qu'une fois le numéro vérifié. */}
            <PhoneVerificationDialog open={phoneWallOpen} />
            {/* Le mur de capacité : même mécanique, pour un compte créé alors que le pool d'engines
                est vide. Il tombe tout seul au chargement suivant où une machine est disponible. */}
            <EngineWaitlistDialog open={foremanWaitlisted && !isAnonymous} />
            <PostPaymentDialog open={postPaymentOpen} onOpenChange={setPostPaymentOpen} />
            {purchase && <TemplatePurchaseSuccessDialog slug={purchase.slug} sessionId={purchase.sessionId} onOpenChange={open => !open && useTemplateFlowStore.getState().closePurchase()} />}
            {templateLinkSlug && <TemplateDeepLinkDialog slug={templateLinkSlug} />}
            {shareLinkToken && <AgentShareDeepLinkDialog token={shareLinkToken} />}
            <ChangelogDialog />
            <ControlCenter />
            <WorkspaceDialogs />
        </div>
    )
}
