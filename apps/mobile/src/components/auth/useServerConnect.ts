import { useState } from 'react'

import { useSignInFlow } from '@/components/auth/SignInFlow'
import { switchServer } from '@/config/custom-server'
import { lookUpServer, normalizeServerUrl, type ServerProblem } from '@/config/server-connect'

export function useServerConnect() {
    const { setThinking } = useSignInFlow()
    const [address, setAddress] = useState('')
    const [connecting, setConnecting] = useState(false)
    const [error, setError] = useState<ServerProblem | null>(null)

    const connect = async () => {
        const typed = normalizeServerUrl(address)
        if (!typed.ok) return setError(typed.problem)
        setConnecting(true)
        setThinking(true)
        setError(null)
        const found = await lookUpServer(typed.origin)
        if (found.ok) return switchServer(found.server)
        setError(found.problem)
        setConnecting(false)
        setThinking(false)
    }

    const type = (text: string) => {
        setAddress(text)
        setError(null)
    }

    return { address, type, connect, connecting, error }
}
