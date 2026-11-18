import type { Metadata } from 'next'

import { AppAuthBoard } from '@/components/auth/AppAuthBoard'

export const metadata: Metadata = {
    title: 'Moldwright',
    robots: { index: false, follow: false },
}

type Search = { theme?: string | string[] }

export default async function AppAuthBoardPage({ searchParams }: { searchParams: Promise<Search> }) {
    const { theme } = await searchParams
    const scheme = theme === 'light' ? 'light' : 'dark'

    return (
        <main className={`${scheme} fixed inset-0 overflow-hidden bg-background`}>
            <style>{'nextjs-portal{display:none}'}</style>
            <AppAuthBoard />
        </main>
    )
}
