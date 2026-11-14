import { detectInAppBrowser, detectMobileOs } from '@/lib/in-app-browser'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthPageMethods } from './AuthPageMethods'

export default async function AuthPage() {
    const userAgent = (await headers()).get('user-agent') ?? ''
    const phoneLeadsAlone = detectMobileOs(userAgent) !== null
    const showGoogle = !detectInAppBrowser(userAgent)
    return (
        <Suspense fallback={null}>
            <AuthPageMethods phoneLeadsAlone={phoneLeadsAlone} showGoogle={showGoogle} />
        </Suspense>
    )
}
