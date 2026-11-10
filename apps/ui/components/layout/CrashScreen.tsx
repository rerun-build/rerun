'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

export function CrashScreen() {
    const t = useTranslations('common')
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold text-foreground">{t('crash.title')}</h1>
                <p className="text-sm text-muted-foreground">{t('crash.body')}</p>
            </div>
            <div className="flex items-center gap-2">
                <Button onClick={() => window.location.reload()}>{t('crash.reload')}</Button>
                <Button variant="outline" asChild>
                    {/* A hard navigation on purpose: the router state is not trustworthy after a crash. */}
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                    <a href="/">{t('backToDashboard')}</a>
                </Button>
            </div>
        </main>
    )
}
