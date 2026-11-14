import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { Appearance } from 'react-native'

export type AppearancePreference = 'system' | 'light' | 'dark'

const APPEARANCE_KEY = 'rerun.appearance'

let current: AppearancePreference = 'system'

export function parseAppearance(stored: string | null): AppearancePreference {
    return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function applyAppearance(preference: AppearancePreference) {
    current = preference
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference)
}

export async function loadAppearance(): Promise<AppearancePreference> {
    const preference = parseAppearance(await SecureStore.getItemAsync(APPEARANCE_KEY).catch(() => null))
    applyAppearance(preference)
    return preference
}

export function useAppearancePreference(): [AppearancePreference, (preference: AppearancePreference) => void] {
    const [preference, setPreference] = useState(current)

    const choose = (next: AppearancePreference) => {
        setPreference(next)
        applyAppearance(next)
        SecureStore.setItemAsync(APPEARANCE_KEY, next)
    }

    return [preference, choose]
}

export function useAppearanceLoaded(): boolean {
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        loadAppearance().finally(() => setLoaded(true))
    }, [])

    return loaded
}
