import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { confirmLogin } from './actions'
import { getTranslations } from 'next-intl/server'

// Opening the link does not sign in: the emailed token works once and the browser's prefetch would
// spend it. The click, a POST through a server action, consumes it and opens the session.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
    const { token_hash, type } = await searchParams
    const t = await getTranslations('auth.confirm')

    if (!token_hash || !type) {
        return (
            <Card className="space-y-4 p-8">
                <div className="space-y-2">
                    <h1 className="text-xl font-semibold tracking-tight">{t('invalidTitle')}</h1>
                    <p className="text-sm text-muted-foreground">{t('invalidMessage')}</p>
                </div>
                <Button asChild variant="secondary" className="w-full">
                    <Link href={routes.auth}>{t('newCode')}</Link>
                </Button>
            </Card>
        )
    }

    return (
        <Card className="space-y-6 p-8">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
                <p className="text-sm text-muted-foreground">{t('message')}</p>
            </div>

            <form action={confirmLogin}>
                <input type="hidden" name="token_hash" value={token_hash} />
                <input type="hidden" name="type" value={type} />
                <Button type="submit" className="w-full">
                    {t('submit')}
                </Button>
            </form>
        </Card>
    )
}
