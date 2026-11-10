'use client'

import type { ReactNode } from 'react'

import { Badge, Button, ScrollFade } from '../primitives'
import { Markdown } from '../markdown'
import { ExpertAvatar } from './ExpertAvatar'
import { ExpertAvailability } from './ExpertAvailability'
import { ChipList, SocialLinks } from './expert-profile-parts'
import { badgeTone } from './options'
import type { Expert } from './types'
import { useKitTranslations } from '../locale'

const HIRE_CLASSNAME = 'w-full rounded-lg dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black'

// `action` is the footer call to action. The landing passes its real hire button on a published
// profile; in an edit wizard nothing is passed and the inert default is only there to show what the
// card will look like.
export function ExpertProfilePreview({ expert, action }: { expert: Expert; action?: ReactNode }) {
    const t = useKitTranslations()
    const subtitle = expert.location ?? ''

    return (
        <div className="flex h-full min-h-0 flex-col">
            <ScrollFade className="min-h-0 flex-1" fadeSize={32}>
                <div className="relative h-44 bg-foreground/5">
                    <img src={expert.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" />
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-card to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />
                </div>

                <div className="relative -mt-10 flex flex-col gap-6 px-6 pb-6">
                    <div>
                        <ExpertAvatar
                            initials={expert.initials}
                            src={expert.avatarUrl}
                            className="size-20 text-2xl ring-4 ring-card"
                        />
                        <div className="mt-4 flex items-center gap-2">
                            <h2 className="font-heading text-xl font-semibold text-foreground">{expert.name}</h2>
                            <ExpertAvailability availability={expert.availability} />
                            <Badge tone={badgeTone(expert.badge)} size="sm">
                                {expert.badge}
                            </Badge>
                        </div>
                        {subtitle && <p className="mt-1 text-sm text-foreground/50">{subtitle}</p>}
                    </div>

                    {expert.bio && <Markdown content={expert.bio} className="text-sm text-foreground/70" />}

                    <ChipList title={t('experts.wizard.skills')} items={expert.skills} />
                    <ChipList title={t('experts.wizard.languages')} items={expert.languages} />

                    {expert.budget && (
                        <div>
                            <h4 className="text-xs font-medium tracking-wide text-foreground/40 uppercase">{t('experts.wizard.budget')}</h4>
                            <p className="mt-2 text-sm text-foreground/70">{expert.budget}</p>
                        </div>
                    )}
                </div>
            </ScrollFade>

            <div className="flex flex-col gap-4 border-t border-foreground/5 px-6 py-4">
                <SocialLinks expert={expert} />
                {action ?? <Button className={HIRE_CLASSNAME}>{t('experts.preview.hire')}</Button>}
            </div>
        </div>
    )
}
