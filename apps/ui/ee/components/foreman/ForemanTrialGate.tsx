'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { openCrisp } from '@/lib/crisp'
import type { TrialStep } from '@/lib/foreman/next-steps'
import { LockIcon } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

// Le pied de la colonne une fois la carte d'essai posée : tout ce qui serait tapé ici serait un tour
// de modèle offert qui ne lance pas l'essai, donc le composer cède la place. Le bouton qui lance
// l'essai est déjà dans la conversation (la carte, ou sous la réponse du Foreman) ; ici il ne reste
// que la sortie vers une personne, pour qui bute sur le paiement.
export function ForemanTrialGate({ step }: { step: TrialStep }) {
    const t = useTranslations('foreman.trialGate')
    const { session } = useSession()

    return (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                <Icon icon={LockIcon} size="sm" className="shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{step === 'trial_refused' ? t('plan') : t('trial')}</p>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => openCrisp(session?.user?.email)}>
                {t('talk')}
            </Button>
        </div>
    )
}
