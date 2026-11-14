import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { appBuild } from '@/api/client'
import { fetchClientConfig } from '@/api/client-config'

export function buildIsTooOld(build: number, minBuild: number): boolean {
    return build < minBuild
}

export function useUpdateRequired(): boolean {
    const [required, setRequired] = useState(false)

    useEffect(() => {
        if (__DEV__) return
        const check = () => {
            fetchClientConfig()
                .then(config => setRequired(buildIsTooOld(appBuild, config.minBuild)))
                .catch(() => {})
        }
        check()
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') check()
        })
        return () => subscription.remove()
    }, [])

    return required
}
