import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { Icon } from '@/components/ui/icon'
import { BASE_PLAN_CREDITS, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS } from '@/ee/lib/billing/plans'
import { PRO_PERKS, type ProPerk } from '@/ee/lib/billing/pro-perks'

// The perks are listed in lib with their English copy; the rows this table knows by id read from the
// language pack, an unknown one keeps its own wording.
function perkCopy(t: ReturnType<typeof useTranslations<'billing.perks'>>, perk: ProPerk): { title: string; trial: string; pro: string } {
    switch (perk.id) {
        case 'credits':
            return { title: t('rows.credits.title'), trial: t('rows.credits.trial', { credits: TRIAL_CREDITS }), pro: t('rows.credits.pro', { credits: BASE_PLAN_CREDITS }) }
        case 'coworkers':
            return { title: t('rows.coworkers.title'), trial: t('rows.coworkers.trial', { count: TRIAL_ACTIVE_AGENTS }), pro: t('rows.coworkers.pro') }
        case 'team':
            return { title: t('rows.team.title'), trial: t('rows.team.trial'), pro: t('rows.team.pro') }
        default:
            return perk
    }
}

export function PerksComparison() {
    const t = useTranslations('billing.perks')
    return (
        <div className="@container relative flex flex-col rounded-2xl bg-background/60 p-4 ring-1 ring-border sm:p-5">
            <BorderBeam />
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-normal">
                            <span className="sr-only">{t('feature')}</span>
                        </th>
                        <th className="pb-2 pl-4 font-normal">{t('trial')}</th>
                        <th className="pb-2 pl-4 font-medium text-foreground">{t('pro')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {PRO_PERKS.map(perk => ({ perk, text: perkCopy(t, perk) })).map(({ perk, text }) => (
                        <tr key={perk.id}>
                            <th scope="row" className="py-2.5 text-left font-normal whitespace-nowrap text-muted-foreground">
                                <span className="flex items-center gap-2.5">
                                    <Icon size="sm" icon={perk.icon} className="@max-md:hidden" />
                                    {text.title}
                                </span>
                            </th>
                            <td className="py-2.5 pl-4 text-muted-foreground">{text.trial}</td>
                            <td className="py-2.5 pl-4 font-medium">{text.pro}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
