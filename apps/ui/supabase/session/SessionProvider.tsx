'use client'

import { isAdminEmail } from '@/lib/auth/admin-emails'
import { Database } from '@/app/api/database.types'
import { routes } from '@/lib/routes'
import { parsePriceArm, PRICE_EXPERIMENT_KEY, PRICE_PROPERTY, isSubscriptionEntitled, TRIAL_CARD_PROPERTY, trialArm } from '@rerun/cloud/billing'
import { createClient } from '@/supabase/client'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'
import { enterActiveWorkspace, isWorkspaceSwitchInFlight } from '@/lib/workspace/workspace-switch'
import { clearTabWorkspace, installWorkspaceHeader, pinTabWorkspace, readTabWorkspace, readUrlWorkspace } from '@/lib/workspace/tab-workspace'
import { PHONE_STATUS_COLUMNS, phoneStatusOf, type PhoneStatus } from '@rerun/cloud/phone'
import { awaitSignupStamp } from '@/supabase/session/signup-stamp'
import { Session } from '@supabase/supabase-js'
import { track, readAttribution, getCookie, identifyPerson, setSharedCookie, deleteSharedCookie } from '@rerun/analytics/client'
import { experimentProperties, readExperimentCookie, STALE_EXPERIMENT_PROPERTIES, writeExperimentVariants } from '@rerun/analytics/experiments'
import { SIGNUP_INTENT_COOKIE, type SignupMethod } from '@rerun/analytics'
import { clearSessionHintCookie, readConsentCookie, reportAffiliateSignup } from '@rerun/contracts'
import posthog from 'posthog-js'
import { useRouter } from 'next/navigation'
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { selectMany, selectMaybeSingle, selectSingle } from '../supabase-helpers'

type Workspace = Pick<
    Database['public']['Tables']['workspaces']['Row'],
    | 'id'
    | 'name'
    | 'icon_url'
    | 'plan'
    | 'stripe_customer_id'
    | 'max_agents'
    | 'max_seats'
    | 'model_access'
    | 'custom_integrations'
    | 'subscription_status'
    | 'current_period_end'
    | 'trial_ends_at'
    | 'rerun_used_micros'
    | 'rerun_budget_micros'
    | 'rerun_topup_micros'
    | 'rerun_period_anchor'
    | 'rerun_credit_paused_at'
    | 'is_sandbox'
    | 'onboarded_at'
    | 'boxes_archived_at'
    | 'price_arm'
    | 'locale'
>
type User = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'workspace_id' | 'email_notification_prefs' | 'account_role' | 'expert_profile_id' | 'signed_up_at' | 'locale'>
type WorkspaceAnswers = Database['public']['Tables']['workspace_onboarding']['Row']['answers']
export type WorkspaceRole = Database['public']['Enums']['workspace_role']
export type BoxScope = 'all' | 'assigned'

function toBoxScope(value: string | null | undefined): BoxScope {
    return value === 'assigned' ? 'assigned' : 'all'
}

const FRESH_SIGNUP_MS = 60 * 60 * 1000

installWorkspaceHeader()

const WORKSPACE_COLUMNS = ['id', 'name', 'icon_url', 'created_at', 'plan', 'stripe_customer_id', 'max_agents', 'max_seats', 'model_access', 'custom_integrations', 'subscription_status', 'current_period_end', 'trial_ends_at', 'rerun_used_micros', 'rerun_budget_micros', 'rerun_topup_micros', 'rerun_period_anchor', 'rerun_credit_paused_at', 'is_sandbox', 'boxes_disabled_at', 'boxes_archived_at', 'onboarded_at', 'price_arm', 'locale'] as const

export type PhoneStep = 'unknown' | 'pending' | 'clear'

export type SessionContextValue = {
    user: User | null
    workspace: Workspace | null
    workspaceAnswers: WorkspaceAnswers | null
    role: WorkspaceRole | null
    boxScope: BoxScope | null
    workspaces: Workspace[]
    session: Session | null
    isAnonymous: boolean
    phoneStep: PhoneStep
    phoneStatus: PhoneStatus | null
    refreshPhoneStep: () => Promise<void>
    loading: boolean
    signOut: () => Promise<void>
    refreshWorkspace: () => Promise<void>
    refreshUser: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: PropsWithChildren) {
    const [user, setUser] = useState<User | null>(null)
    const [workspace, setWorkspace] = useState<Workspace | null>(null)
    const [loadedAnswers, setLoadedAnswers] = useState<{ workspaceId: number; answers: WorkspaceAnswers | null } | null>(null)
    const [loadedRole, setLoadedRole] = useState<{ workspaceId: number; role: WorkspaceRole; boxScope: BoxScope } | null>(null)
    const [roleReads, setRoleReads] = useState(0)
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [session, setSession] = useState<Session | null>(null)
    const [phoneRead, setPhoneRead] = useState<{ userId: string; status: PhoneStatus } | null>(null)
    const [userLoading, setUserLoading] = useState(true)
    const [workspaceLoading, setWorkspaceLoading] = useState(true)
    const supabase = createClient()
    const router = useRouter()
    const sessionUserId = useRef<string | null>(null)
    const loadedUserIdRef = useRef<string | null>(null)
    const userReadSeq = useRef(0)
    const loadedWorkspaceRef = useRef<{ userId: string; workspaceId: number } | null>(null)
    const storedWorkspaceIdRef = useRef<number | null>(null)

    useEffect(() => {
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            const nextUserId = session?.user?.id ?? null
            const switchedAccount = event !== 'INITIAL_SESSION' && event !== 'SIGNED_OUT' && nextUserId !== sessionUserId.current
            sessionUserId.current = nextUserId
            if (switchedAccount) {
                setUser(null)
                setUserLoading(true)
                setWorkspace(null)
                setWorkspaceLoading(true)
                useBoardStore.getState().reset()
                useForemanStore.getState().reset()
                clearTabWorkspace()
                posthog.unregister('workspace_id')
            }

            if (event === 'SIGNED_OUT') {
                useBoardStore.getState().reset()
                clearTabWorkspace()
                posthog.reset()
                clearSessionHintCookie()
                setUser(null)
                setWorkspace(null)
                setWorkspaces([])
            }
            setSession(session)
            if (event === 'TOKEN_REFRESHED' && !switchedAccount && loadedUserIdRef.current === nextUserId) return
            fetchUser()
        })

        return () => subscription.unsubscribe()
    }, [])

    useEffect(() => {
        if (!user?.workspace_id) return
        const loaded = loadedWorkspaceRef.current
        if (loaded?.userId === user.id && loaded.workspaceId !== user.workspace_id) {
            if (!isWorkspaceSwitchInFlight()) enterActiveWorkspace()
            return
        }
        loadedWorkspaceRef.current = { userId: user.id, workspaceId: user.workspace_id }
        pinTabWorkspace(user.workspace_id)
        fetchWorkspace()
    }, [user?.id, user?.workspace_id])

    useEffect(() => {
        if (user?.id) {
            fetchWorkspaces()
        }
    }, [user?.id])

    const workspaceId = workspace?.id ?? null
    const memberId = user?.id ?? null
    const role = loadedRole && loadedRole.workspaceId === workspaceId ? loadedRole.role : null
    const boxScope = loadedRole && loadedRole.workspaceId === workspaceId ? loadedRole.boxScope : null
    useEffect(() => {
        if (!memberId || workspaceId === null) return
        let cancelled = false
        void selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope'] as const, { user_id: memberId, workspace_id: workspaceId }).then(({ data }) => {
            if (!cancelled && data) setLoadedRole({ workspaceId, role: data.role, boxScope: toBoxScope(data.box_scope) })
        })
        return () => {
            cancelled = true
        }
    }, [memberId, workspaceId, roleReads])

    const workspaceAnswers = loadedAnswers && loadedAnswers.workspaceId === workspaceId ? loadedAnswers.answers : null
    useEffect(() => {
        if (workspaceId === null) return
        let cancelled = false
        void selectMaybeSingle(supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: workspaceId }).then(({ data }) => {
            if (!cancelled) setLoadedAnswers({ workspaceId, answers: data?.answers ?? null })
        })
        return () => {
            cancelled = true
        }
    }, [workspaceId, workspace?.onboarded_at])

    useEffect(() => {
        const email = session?.user?.email
        if (email) {
            const attribution = readAttribution()
            identifyPerson(
                email,
                { email, is_internal: isAdminEmail(email) },
                {
                    initial_utm_source: attribution.utm_source,
                    initial_utm_campaign: attribution.utm_campaign,
                    initial_referrer_domain: attribution.referrer_domain,
                },
            )
        }
    }, [session?.user?.email])

    useEffect(() => {
        if (workspace?.id) posthog.register({ workspace_id: workspace.id })
    }, [workspace?.id])

    useEffect(() => {
        for (const stale of STALE_EXPERIMENT_PROPERTIES) posthog.unregister(stale)
        const properties = experimentProperties(readExperimentCookie())
        if (Object.keys(properties).length > 0) posthog.register(properties)
    }, [session?.user?.id])

    const priceArm = workspace?.price_arm ? parsePriceArm(workspace.price_arm) : null
    useEffect(() => {
        if (!priceArm || readConsentCookie() === 'denied') return
        const variants = readExperimentCookie()
        if (variants[PRICE_EXPERIMENT_KEY] !== priceArm) writeExperimentVariants({ ...variants, [PRICE_EXPERIMENT_KEY]: priceArm })
        posthog.register({ [PRICE_PROPERTY]: priceArm })
        posthog.setPersonProperties({ [PRICE_PROPERTY]: priceArm })
    }, [priceArm, session?.user?.id])

    const trialTestArm = workspace && !workspace.trial_ends_at && !workspace.is_sandbox && !isSubscriptionEntitled(workspace.subscription_status) ? trialArm(workspace.id) : null
    useEffect(() => {
        if (!trialTestArm) return
        posthog.register({ [TRIAL_CARD_PROPERTY]: trialTestArm })
        posthog.setPersonProperties(undefined, { [TRIAL_CARD_PROPERTY]: trialTestArm })
    }, [trialTestArm, session?.user?.id])

    const signedUpAt = user?.id === session?.user?.id ? user?.signed_up_at : null
    useEffect(() => {
        const authUser = session?.user
        if (!authUser || authUser.is_anonymous || !signedUpAt) return
        if (getCookie('rr_signup_at')) return
        const method = getCookie(SIGNUP_INTENT_COOKIE) as SignupMethod | undefined
        if (!method) return
        if (Date.now() - Date.parse(signedUpAt) > FRESH_SIGNUP_MS) {
            deleteSharedCookie(SIGNUP_INTENT_COOKIE)
            return
        }
        track('account_created', { method, ...readAttribution() })
        reportAffiliateSignup({ email: authUser.email, externalUserId: authUser.id })
        setSharedCookie('rr_signup_at', String(Date.now()))
        deleteSharedCookie(SIGNUP_INTENT_COOKIE)
    }, [session?.user?.id, session?.user?.is_anonymous, signedUpAt])

    const accountId = session?.user && !session.user.is_anonymous ? session.user.id : null

    useEffect(() => {
        if (!accountId || user?.id !== accountId || user.signed_up_at) return
        const controller = new AbortController()
        void awaitSignupStamp(async () => (await selectMaybeSingle(supabase, 'users', ['signed_up_at'] as const, { id: accountId })).data?.signed_up_at ?? null, controller.signal).then(stamp => {
            if (stamp) setUser(previous => (previous?.id === accountId ? { ...previous, signed_up_at: stamp } : previous))
        })
        return () => controller.abort()
    }, [accountId, user?.id, user?.signed_up_at])

    const readPhoneStep = useCallback(async () => {
        if (!accountId) return null
        const { data } = await selectMaybeSingle(supabase, 'user_phones', PHONE_STATUS_COLUMNS, { user_id: accountId })
        return { userId: accountId, status: phoneStatusOf(data) }
    }, [accountId])
    useEffect(() => {
        if (signedUpAt) void readPhoneStep().then(setPhoneRead)
    }, [signedUpAt, readPhoneStep])
    const refreshPhoneStep = useCallback(async () => setPhoneRead(await readPhoneStep()), [readPhoneStep])

    useRealtimeSubscription('user_phones', {
        channelId: 'phone-step-provider',
        filter: accountId ? { column: 'user_id', value: accountId } : undefined,
        enabled: !!accountId,
        onInsert: row => setPhoneRead({ userId: row.user_id, status: phoneStatusOf(row) }),
        onUpdate: row => setPhoneRead({ userId: row.user_id, status: phoneStatusOf(row) }),
        onResync: () => {
            if (signedUpAt) void refreshPhoneStep()
        },
    })
    const phoneStatus = accountId && phoneRead?.userId === accountId ? phoneRead.status : null
    const phoneStep: PhoneStep = !accountId ? 'clear' : !phoneStatus ? 'unknown' : phoneStatus === 'pending' ? 'pending' : 'clear'

    useRealtimeSubscription('users', {
        channelId: 'user-provider',
        filter: user?.id ? { column: 'id', value: user.id } : undefined,
        enabled: !!user?.id,
        onUpdate: updatedUser => {
            setUser(previous => ({ ...(updatedUser as User), workspace_id: previous?.workspace_id ?? updatedUser.workspace_id }))
            if (updatedUser.workspace_id !== storedWorkspaceIdRef.current) {
                storedWorkspaceIdRef.current = updatedUser.workspace_id
                void fetchWorkspaces()
            }
        },
        onResync: () => {
            if (accountId && !signedUpAt) void fetchUser()
        },
    })

    useRealtimeSubscription('workspaces', {
        channelId: 'workspace-provider',
        filter: user?.workspace_id ? { column: 'id', value: user.workspace_id } : undefined,
        enabled: !!user?.workspace_id,
        onUpdate: updatedWorkspace => {
            setWorkspace(updatedWorkspace as Workspace)
        },
    })

    useRealtimeSubscription('workspace_members', {
        channelId: 'workspace-members-provider',
        filter: user?.id ? { column: 'user_id', value: user.id } : undefined,
        enabled: !!user?.id,
        onInsert: () => fetchWorkspaces(),
        onUpdate: row => {
            if (row.workspace_id === workspaceId) setLoadedRole({ workspaceId: row.workspace_id, role: row.role, boxScope: toBoxScope(row.box_scope) })
        },
        onDelete: () => fetchWorkspaces(),
        onResync: () => setRoleReads(reads => reads + 1),
    })

    async function fetchUser() {
        const seq = ++userReadSeq.current
        const { data } = await selectSingle(supabase, 'users', ['id', 'created_at', 'workspace_id', 'email_notification_prefs', 'account_role', 'expert_profile_id', 'signed_up_at', 'locale'], {})
        const tabUser = data && { ...data, workspace_id: await resolveTabWorkspace(data) }
        if (seq !== userReadSeq.current) return
        loadedUserIdRef.current = data?.id ?? null
        storedWorkspaceIdRef.current = data?.workspace_id ?? null
        setUser(tabUser)
        setUserLoading(false)
    }

    async function resolveTabWorkspace(row: User): Promise<number> {
        const pinned = readUrlWorkspace() ?? readTabWorkspace()
        if (pinned === null || pinned === row.workspace_id) return row.workspace_id
        const { data } = await selectMaybeSingle(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: row.id, workspace_id: pinned })
        return data ? pinned : row.workspace_id
    }

    async function fetchWorkspace() {
        const { data } = await selectSingle(supabase, 'workspaces', WORKSPACE_COLUMNS, { id: user?.workspace_id })
        setWorkspace(data)
        setWorkspaceLoading(false)
    }

    async function fetchWorkspaces() {
        if (!user?.id) return
        const { data: memberships } = await selectMany(supabase, 'workspace_members', ['workspace_id'], { user_id: user.id })
        const ids = (memberships ?? []).map(m => m.workspace_id)
        const tabWorkspaceId = user.workspace_id
        if (tabWorkspaceId && tabWorkspaceId !== storedWorkspaceIdRef.current && !ids.includes(tabWorkspaceId) && !isWorkspaceSwitchInFlight()) {
            enterActiveWorkspace()
            return
        }
        if (ids.length === 0) {
            setWorkspaces([])
            return
        }
        const { data } = await selectMany(supabase, 'workspaces', WORKSPACE_COLUMNS, { id: ids })
        setWorkspaces(data ?? [])
    }

    usePresenceHeartbeat(!!user?.id && !session?.user?.is_anonymous)

    const signOut = async () => {
        await supabase.auth.signOut()
        router.push(routes.auth)
    }

    return <SessionContext.Provider value={{ user, workspace, workspaceAnswers, role, boxScope, workspaces, session, isAnonymous: session?.user?.is_anonymous ?? false, phoneStep, phoneStatus, refreshPhoneStep, loading: userLoading || workspaceLoading, signOut, refreshWorkspace: fetchWorkspace, refreshUser: fetchUser }}>{children}</SessionContext.Provider>
}

export function SessionFixture({ value, children }: PropsWithChildren<{ value: SessionContextValue }>) {
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useOptionalSession() {
    return useContext(SessionContext)
}

export function useSession() {
    const context = useContext(SessionContext)
    if (!context) {
        throw new Error('useSession must be used within a SessionProvider')
    }
    return context
}

export function useIsWorkspaceAdmin(): boolean {
    return useSession().role === 'admin'
}
