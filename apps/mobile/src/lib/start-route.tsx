import { router, type Href } from 'expo-router'
import { useEffect } from 'react'

// A development build started with EXPO_PUBLIC_START_ROUTE opens that route once it is up: a remote
// simulator reaches a lab without a tap. A store build never reads it.
const START_ROUTE = __DEV__ ? process.env.EXPO_PUBLIC_START_ROUTE : undefined

export function OpenStartRoute() {
    useEffect(() => {
        if (!START_ROUTE) return
        const timer = setTimeout(() => router.push(START_ROUTE as Href), 0)
        return () => clearTimeout(timer)
    }, [])
    return null
}
