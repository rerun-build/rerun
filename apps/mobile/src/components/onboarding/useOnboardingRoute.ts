import type { ForemanPhase, ForemanStateResponse } from '@moldwright/contracts'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { fetchForemanState } from '@/api/foreman'
import { useAuth } from '@/auth/AuthProvider'
import { cachedRoute } from '@/data/local-cache'

const ONBOARDING_PHASES: readonly ForemanPhase[] = ['discover', 'plan', 'trial', 'build']
const WAITLIST_POLL_MS = 60_000

export type OnboardingRoute = { kind: 'loading' } | { kind: 'onboarding'; state: ForemanStateResponse } | { kind: 'waitlist' } | { kind: 'app' }

export function routeOf(state: ForemanStateResponse): OnboardingRoute {
    if (state.phase === 'waitlist') return { kind: 'waitlist' }
    return ONBOARDING_PHASES.includes(state.phase) ? { kind: 'onboarding', state } : { kind: 'app' }
}

export function useOnboardingRoute(): { route: OnboardingRoute; reload: () => void } {
    const { session, me, refreshMe } = useAuth()
    const [read, setRead] = useState<{ workspaceId: number; route: OnboardingRoute } | null>(null)
    const [version, setVersion] = useState(0)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const subscribed = me?.workspace.subscribed

    const reload = useCallback(() => setVersion(current => current + 1), [])

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        let cancelled = false
        fetchForemanState({ accessToken, workspaceId })
            .then(state => {
                if (cancelled) return
                const route = routeOf(state)
                if (route.kind === 'app' || route.kind === 'waitlist') cachedRoute(workspaceId).save(route.kind)
                setRead({ workspaceId, route })
            })
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
