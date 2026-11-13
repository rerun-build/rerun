import type { Me } from '@rerun/contracts'
import type { Session } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { fetchMe } from '@/api/account'
import { isAdminRole } from '@/auth/access'
import { ApiError } from '@/api/client'
import { forgetGoogleAccount } from '@/auth/google'
import { bootstrap } from '@/auth/sign-in'
import { supabase } from '@/auth/supabase'
import { cachedMe, clearLocalCache } from '@/data/local-cache'
import { forgetPerson, identifyPerson, registerWorkspace } from '@/lib/analytics'
import { registerDevice, unregisterDevice } from '@/notifications/push'

// Each device keeps its own active workspace, as the hub expects: it is named on every request
// instead of moving the account's default under the web session.
const WORKSPACE_KEY = 'rerun.workspace-id'

type AuthState = {
    // False until the stored session has been read: the app shows nothing rather than flash sign-in.
    ready: boolean
    session: Session | null
    me: Me | null
    switchWorkspace: (workspaceId: number) => Promise<void>
    // Reads the account again, for what changes under it: a workspace that just started its plan.
    refreshMe: () => Promise<void>
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function storedWorkspaceId(): Promise<number | null> {
    const raw = await SecureStore.getItemAsync(WORKSPACE_KEY)
    return raw && /^\d+$/.test(raw) ? Number(raw) : null
}

// The account's default workspace comes back from bootstrap. The one this device last picked wins over
// it, unless the account has since left it.
async function loadMe(accessToken: string): Promise<Me> {
    const provisioned = await bootstrap(accessToken)
    const picked = await storedWorkspaceId()
    if (picked === null || picked === provisioned.workspace.id) return provisioned
    try {
        return await fetchMe({ accessToken, workspaceId: picked })
    } catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404)) throw error
        await SecureStore.deleteItemAsync(WORKSPACE_KEY)
        return provisioned
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false)
    const [session, setSession] = useState<Session | null>(null)
    const [me, setMe] = useState<Me | null>(null)
    // The workspace last picked in this session: a read of the account sent before the pick (a refresh
    // as the app comes back to the foreground on a tapped push) must not take the person back.
    const picked = useRef<number | null>(null)
    const accepts = useCallback((next: Me) => picked.current === null || next.workspace.id === picked.current, [])
    const applyMe = useCallback(
        (next: Me) => {
            if (accepts(next)) setMe(next)
        },
        [accepts]
    )

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session)
            // The account as last read: the home opens on it while the hub is asked again.
            if (data.session) setMe(cachedMe(data.session.user.id).read())
            setReady(true)
        })
        const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next)
            if (!next) {
                setMe(null)
                picked.current = null
                clearLocalCache()
            }
        })
        return () => listener.subscription.unsubscribe()
    }, [])

    const email = session?.user.email
    useEffect(() => {
        if (email) identifyPerson(email)
    }, [email])

    const workspaceId = me?.workspace.id
    const accessToken = session?.access_token
    useEffect(() => {
        if (workspaceId) registerWorkspace(workspaceId)
    }, [workspaceId])

    // Keyed on the user, not the session: a token refresh hands back a new session for the same person.
    const userId = session?.user.id
    useEffect(() => {
        if (!userId) return
        let cancelled = false
        supabase.auth
            .getSession()
            .then(({ data }) => {
                const signedIn = data.session
                return signedIn ? cachedMe(signedIn.user.id).load(() => loadMe(signedIn.access_token), accepts) : null
            })
            .then(result => {
                if (!cancelled && result) applyMe(result)
            })
            .catch(error => console.warn('[auth] loading the account failed', error))
        return () => {
            cancelled = true
        }
    }, [userId, accepts, applyMe])

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        registerDevice({ accessToken, workspaceId }).catch(error => console.warn('[push] registering the device failed', error))
        // Once per signed-in person, not per refreshed token.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, workspaceId])

    const switchWorkspace = useCallback(
        async (workspaceId: number) => {
            if (!session) return
            const previous = picked.current
            picked.current = workspaceId
            try {
                applyMe(await cachedMe(session.user.id).load(() => fetchMe({ accessToken: session.access_token, workspaceId }), accepts))
            } catch (error) {
                if (picked.current === workspaceId) picked.current = previous
                throw error
            }
            // A later switch has taken over: the store follows it, not this answer.
            if (picked.current !== workspaceId) return
            await SecureStore.setItemAsync(WORKSPACE_KEY, String(workspaceId))
        },
        [session, accepts, applyMe]
    )

    const refreshMe = useCallback(async () => {
        if (!session || !me) return
        applyMe(await cachedMe(session.user.id).load(() => fetchMe({ accessToken: session.access_token, workspaceId: me.workspace.id }), accepts))
    }, [session, me, accepts, applyMe])

    // The screen leaves first: the hub call, supabase-js's lock or the auth event must never hold the
    // person on a home they asked to leave. A local sign-out still tells Supabase to revoke this
    // session's refresh token, and leaves the person's other devices signed in; the device is
    // unregistered behind, while the access token is still good.
    const signOut = useCallback(async () => {
        const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
        setSession(null)
        setMe(null)
        picked.current = null
        clearLocalCache()
        if (caller) unregisterDevice(caller).catch(() => {})
        await SecureStore.deleteItemAsync(WORKSPACE_KEY).catch(() => {})
        await supabase.auth.signOut({ scope: 'local' }).catch(error => console.warn('[auth] signing out failed', error))
        forgetGoogleAccount()
        forgetPerson().catch(() => {})
    }, [session, me])

    return <AuthContext.Provider value={{ ready, session, me, switchWorkspace, refreshMe, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
    const value = useContext(AuthContext)
    if (!value) throw new Error('useAuth must be used inside AuthProvider')
    return value
}

// Read off the active workspace's account, so switching workspace switches the role with it.
export function useIsWorkspaceAdmin(): boolean {
    return isAdminRole(useAuth().me?.workspace.role)
}
