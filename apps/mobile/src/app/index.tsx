import { Redirect } from 'expo-router'

import { LAST_CONVERSATION } from '@/components/chat/ForemanChat'
import { HomeScreen } from '@/components/home/HomeScreen'
import { useIsSplit } from '@/components/layout/PaneSize'

export default function Home() {
    const split = useIsSplit()
    if (split) return <Redirect href={{ pathname: '/chat/[id]', params: { id: LAST_CONVERSATION } }} />
    return <HomeScreen />
}
