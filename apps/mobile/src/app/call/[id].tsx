import { ROUTE_ID_PATTERN } from '@rerun/contracts'
import { Redirect, useLocalSearchParams } from 'expo-router'

import { CallScreen } from '@/call/CallScreen'

// `id` names the coworker to call. It lands in hub paths, so anything else opens the home instead.
export default function Call() {
    const { id } = useLocalSearchParams<{ id: string }>()
    if (!ROUTE_ID_PATTERN.test(id)) return <Redirect href="/" />
    return <CallScreen agentId={id} />
}
