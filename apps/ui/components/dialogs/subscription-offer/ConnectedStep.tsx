'use client'

import { ExplainerCheck } from '@/components/dialogs/ExplainerPanel'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PROVIDER_PITCH, type AddableProvider } from '@/lib/engine/ai-sources'

import { OfferFooter } from './offer-footer'
import { PLANS, PROVIDER_GLYPH } from './offer-plans'

function connectedCopy(provider: AddableProvider) {
    if (provider === 'claude' || provider === 'codex') {
        const { name } = PLANS[provider]
        return { title: `${name} is connected`, detail: `Your coworkers now run on your ${name} plan.` }
    }
    if (provider === 'opencode') return { title: 'OpenCode is connected', detail: 'Your coworkers now run on your OpenCode Go plan.' }
    return { title: `${PROVIDER_PITCH[provider].title} is connected`, detail: 'Your coworkers now run on this key.' }
}

export function ConnectedStep({ provider, onDone }: { provider: AddableProvider; onDone: () => void }) {
    const { title, detail } = connectedCopy(provider)

    return (
        <>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
                <span className="relative">
                    <Icon size="lg" icon={PROVIDER_GLYPH[provider]} />
                    <span className="absolute -right-2 -bottom-2 z-20">
                        <ExplainerCheck />
                    </span>
                </span>
                <div>
                    <h2 className="text-base font-medium">{title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                </div>
            </div>

            <OfferFooter>
                <Button onClick={onDone}>Done</Button>
            </OfferFooter>
        </>
    )
}
