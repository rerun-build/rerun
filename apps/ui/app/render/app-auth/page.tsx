import type { Metadata } from 'next'

import { AppAuthBoard } from '@/components/auth/AppAuthBoard'
import { getBrand } from '@/lib/brand/server'

// Le décor de la connexion de l'app iOS, que l'app charge dans une WebView au-dessus de sa feuille.
// Hors auth comme tout /render : l'écran qui le montre est justement celui où l'on n'a pas de session.
export async function generateMetadata(): Promise<Metadata> {
    return { title: (await getBrand()).name, robots: { index: false, follow: false } }
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
