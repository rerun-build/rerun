import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function AuthCodeErrorPage() {
    const t = await getTranslations('auth.linkExpired')
    return (
        <Card className="space-y-4 p-8">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
                <p className="text-sm text-muted-foreground">{t('message')}</p>
            </div>
            <Button asChild variant="secondary" className="w-full">
                <Link href={routes.auth}>{t('newCode')}</Link>
            </Button>
        </Card>
    )
}
