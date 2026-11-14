import { router, useNavigation } from 'expo-router'

import { useIsSplit } from '@/components/layout/PaneSize'

export function useChatBack(): (() => void) | undefined {
    const split = useIsSplit()
    const navigation = useNavigation()
    if (split && !navigation.canGoBack()) return undefined
    return () => (router.canGoBack() ? router.back() : router.replace('/'))
}
