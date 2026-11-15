import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'

export type AiConsentState = 'loading' | 'needed' | 'granted'

const consentKey = (userId: string) => `rerun.ai-consent.${userId}`

export async function hasAiConsent(userId: string): Promise<boolean> {
    return (await SecureStore.getItemAsync(consentKey(userId))) !== null
}

export async function grantAiConsent(userId: string): Promise<void> {
    await SecureStore.setItemAsync(consentKey(userId), new Date().toISOString())
}

export function useAiConsent(userId: string | null): { state: AiConsentState; grant: () => Promise<void> } {
    const [granted, setGranted] = useState<{ userId: string; granted: boolean } | null>(null)

    useEffect(() => {
        if (!userId) return
        let live = true
        hasAiConsent(userId)
            .then(found => live && setGranted({ userId, granted: found }))
            .catch(() => live && setGranted({ userId, granted: false }))
        return () => {
            live = false
        }
    }, [userId])

    const grant = useCallback(async () => {
        if (!userId) return
        await grantAiConsent(userId)
        setGranted({ userId, granted: true })
    }, [userId])

    if (!userId || granted?.userId !== userId) return { state: 'loading', grant }
    return { state: granted.granted ? 'granted' : 'needed', grant }
}
