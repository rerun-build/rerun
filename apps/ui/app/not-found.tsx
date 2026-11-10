import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('common.notFound')
    return { title: t('title') }
}

export default async function NotFound() {
    const t = await getTranslations('common')
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground/60">404</p>
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold text-foreground">{t('notFound.title')}</h1>
                <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
            </div>
            <Button asChild>
                <Link href="/">{t('backToDashboard')}</Link>
            </Button>
        </main>
    )
}
