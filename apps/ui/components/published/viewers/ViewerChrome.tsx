import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DownloadIcon, type LucideIcon } from '@/lib/icons'
import { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'
import { cn } from '@/lib/utils'
import { R_PATH } from '@rerun/ui/logo'

export const RAW_URL = '/__rerun/raw'
export const DOWNLOAD_URL = '/__rerun/raw?download=1'

const LANDING_URL = 'https://rerun.build'
const REPORT_EMAIL = 'help@rerun.build'

export function ViewerPage({ slug, bar, children, className }: { slug: string; bar?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div {...{ [PUBLISHED_PAGE_MARKER]: '' }} className="relative flex h-dvh flex-col bg-background text-foreground">
            {bar}
            <main className={cn('min-h-0 flex-1 overflow-auto', className)}>{children}</main>
            <MadeWithRerun slug={slug} className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:right-3" />
        </div>
    )
}

export function DownloadButton({ className }: { className?: string }) {
    const t = useTranslations('published.viewer')
    return (
        <Button variant="ghost" size="sm" className={cn('shrink-0', className)} asChild>
            <a href={DOWNLOAD_URL} download>
                <DownloadIcon />
                <span className="max-md:hidden">{t('download')}</span>
            </a>
        </Button>
    )
}

export function ViewerTopBar({ icon: FormatIcon, name, meta, children }: { icon: LucideIcon; name: string; meta?: ReactNode; children?: ReactNode }) {
    return (
        <header className="z-30 flex h-12 shrink-0 items-center gap-2.5 border-b bg-background/90 px-4 backdrop-blur">
            <FormatIcon className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="min-w-0 truncate text-sm font-medium">{name}</h1>
            {meta && <span className="shrink-0 text-xs text-muted-foreground max-md:hidden">{meta}</span>}
            {children}
            <DownloadButton className="ml-auto" />
        </header>
    )
}

// The same pill lib/published/badge.ts injects into a published HTML page, drawn as React here.
export function MadeWithRerun({ slug, className }: { slug: string; className?: string }) {
    const t = useTranslations('published')
    const landing = `${LANDING_URL}/?utm_source=published&utm_medium=badge&utm_content=${slug}`
    const report = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(`Report published page ${slug}`)}`
    return (
        <div className={cn('z-40 flex items-center gap-0.5 rounded-full border border-white/12 bg-[#0b0b0c] p-1 text-[12px] font-medium whitespace-nowrap text-[#fafafa] shadow-[0_8px_24px_rgba(0,0,0,.24)] print:hidden', className)}>
            <a href={landing} target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 hover:bg-white/8">
                <svg viewBox="0 0 512 512" aria-hidden className="size-3.5">
                    <path d={R_PATH} fill="currentColor" />
                </svg>
                {t('gate.madeWith')}
            </a>
            <a href={report} className="rounded-full px-2.5 py-1.5 text-[#fafafa]/56 hover:bg-white/8">
                {t('viewer.report')}
            </a>
        </div>
    )
}
