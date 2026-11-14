import type { Me } from '@rerun/contracts'
import type { Session } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { fetchMe } from '@/api/account'
import { isAdminRole } from '@/auth/access'
import { ApiError } from '@/api/client'
import { forgetGoogleAccount } from '@/auth/google'
import { bootstrap } from '@/auth/sign-in'
import { supabase } from '@/auth/supabase'
import { cachedMe, clearLocalCache } from '@/data/local-cache'
import { forgetPerson, identifyPerson, registerWorkspace } from '@/lib/analytics'
import { registerDevice, unregisterDevice } from '@/notifications/push'

const WORKSPACE_KEY = 'rerun.workspace-id'

type AuthState = {
    ready: boolean
    session: Session | null
    me: Me | null
    switchWorkspace: (workspaceId: number) => Promise<void>
    refreshMe: () => Promise<void>
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function storedWorkspaceId(): Promise<number | null> {
    const raw = await SecureStore.getItemAsync(WORKSPACE_KEY)
    return raw && /^\d+$/.test(raw) ? Number(raw) : null
}

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

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session)
            if (data.session) setMe(cachedMe(data.session.user.id).read())
            setReady(true)
        })
        const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next)
            if (!next) {
                setMe(null)
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

    const userId = session?.user.id
    useEffect(() => {
        if (!userId) return
        let cancelled = false
        supabase.auth
            .getSession()
            .then(({ data }) => {
                const signedIn = data.session
                return signedIn ? cachedMe(signedIn.user.id).load(() => loadMe(signedIn.access_token)) : null
            })
            .then(result => {
                if (!cancelled && result) setMe(result)
            })
            .catch(error => console.warn('[auth] loading the account failed', error))
        return () => {
            cancelled = true
        }
    }, [userId])

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        registerDevice({ accessToken, workspaceId }).catch(error => console.warn('[push] registering the device failed', error))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, workspaceId])

    const switchWorkspace = useCallback(
        async (workspaceId: number) => {
            if (!session) return
            setMe(await cachedMe(session.user.id).load(() => fetchMe({ accessToken: session.access_token, workspaceId })))
            await SecureStore.setItemAsync(WORKSPACE_KEY, String(workspaceId))
        },
        [session]
    )

    const refreshMe = useCallback(async () => {
        if (!session || !me) return
        setMe(await cachedMe(session.user.id).load(() => fetchMe({ accessToken: session.access_token, workspaceId: me.workspace.id })))
    }, [session, me])

    const signOut = useCallback(async () => {
        const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
        setSession(null)
        setMe(null)
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

export function useIsWorkspaceAdmin(): boolean {
    return isAdminRole(useAuth().me?.workspace.role)
}
