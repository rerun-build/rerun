import type { OnboardingState } from '@rerun/contracts'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { fetchOnboardingState } from '@/api/onboarding'
import { useAuth } from '@/auth/AuthProvider'
import { cachedRoute } from '@/data/local-cache'

const WAITLIST_POLL_MS = 60_000

export type OnboardingRoute = { kind: 'loading' } | { kind: 'onboarding'; state: OnboardingState } | { kind: 'waitlist' } | { kind: 'app' }

// The questions are asked whatever the pool holds, as the welcome page asks them: the wall only stands
// before the start it cannot make.
export function routeOf(state: OnboardingState): OnboardingRoute {
    if (!state.needed) return { kind: 'app' }
    return state.waitlisted && state.stage === 'setup' ? { kind: 'waitlist' } : { kind: 'onboarding', state }
}

// Where the signed-in workspace stands, as the web reads it: still walking its onboarding, waiting for
// a machine, or past it. Read again when the account changes and when the app comes back to the
// foreground, where an onboarding finished on the web shows up.
export function useOnboardingRoute(): { route: OnboardingRoute; reload: () => void } {
    const { session, me, refreshMe } = useAuth()
    const [read, setRead] = useState<{ workspaceId: number; route: OnboardingRoute } | null>(null)
    const [version, setVersion] = useState(0)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    // A workspace that just started its plan leaves the setup: where it stands is read again.
    const subscribed = me?.workspace.subscribed

    const reload = useCallback(() => setVersion(current => current + 1), [])

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        let cancelled = false
        fetchOnboardingState({ accessToken, workspaceId })
            .then(state => {
                if (cancelled) return
                const route = routeOf(state)
                if (route.kind === 'app' || route.kind === 'waitlist') cachedRoute(workspaceId).save(route.kind)
                setRead({ workspaceId, route })
            })
            // A hub that predates the route, or one that cannot be reached: the app opens as it is.
            .catch(error => {
                console.warn('[onboarding] reading where the workspace stands failed', error)
                if (!cancelled) setRead({ workspaceId, route: { kind: 'app' } })
            })
        return () => {
            cancelled = true
        }
    }, [accessToken, workspaceId, subscribed, version])

    useEffect(() => {
        const subscription = AppState.addEventListener('change', next => {
            if (next !== 'active') return
            refreshMe().catch(() => {})
            reload()
        })
        return () => subscription.remove()
    }, [refreshMe, reload])

    const settled = workspaceId ? cachedRoute(workspaceId).read() : null
    const route: OnboardingRoute = read && read.workspaceId === workspaceId ? read.route : settled ? { kind: settled } : { kind: 'loading' }
    const waiting = route.kind === 'waitlist'
    useEffect(() => {
        if (!waiting) return
        const timer = setInterval(reload, WAITLIST_POLL_MS)
        return () => clearInterval(timer)
    }, [waiting, reload])

    return { route, reload }
}
