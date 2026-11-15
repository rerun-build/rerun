'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, RocketIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function LetsGoButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
    const t = useTranslations('connections')
    return (
        <Button type="button" onClick={onClick} disabled={disabled} className="gap-1.5">
            <RocketIcon />
            {t('letsGo')}
        </Button>
    )
}

export function StepError({ error }: { error: string | null }) {
    if (!error) return null
    return (
        <Alert variant="danger">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    )
}
