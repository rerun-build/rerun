import type { Metadata } from 'next'
import { AuthIsoBackground } from '@/components/auth/AuthIsoBackground'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('auth.creatorJoin')
    return { title: t('metaTitle'), description: t('metaDescription'), robots: { index: false, follow: false } }
}

export default function CreatorJoinLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary/20">
            <div className="flex w-full flex-col justify-center items-center px-6 py-12 lg:w-1/2 lg:px-16 xl:px-24">
                <div className="mx-auto w-full max-w-lg">{children}</div>
            </div>
            <div className="relative hidden w-1/2 overflow-hidden border-l bg-muted/30 lg:block">
                <AuthIsoBackground />
                <div className="pointer-events-none absolute inset-0 bg-linear-to-l from-background/0 to-background/40" />
            </div>
        </div>
    )
}
