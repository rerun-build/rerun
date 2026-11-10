import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/AuthShell'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('auth.page')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function AuthFlowLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('auth.page')
    return (
        <div className="h-dvh w-full">
            <AuthShell title={t('title')} subtitle={t('subtitle')}>
                {children}
            </AuthShell>
        </div>
    )
}
