'use client'

import { useEffect, useState } from 'react'
import { confirmTemplatePurchaseAction, getTemplateAccessAction } from '@/ee/actions/template-purchase.actions'
import { getSharedTemplateAction } from '@/app/api/_actions/template.actions'
import type { LibraryTemplate } from '@/lib/templates/library'
import { useTemplatePurchaseStore } from '@/stores/template-purchase.store'

export type PurchaseWait = 'waiting' | 'ready' | 'timeout'

const POLL_INTERVAL_MS = 2000
const GIVE_UP_MS = 30_000

export function useAwaitTemplatePurchase(slug: string, sessionId: string | null) {
    const [state, setState] = useState<PurchaseWait>('waiting')
    const [template, setTemplate] = useState<LibraryTemplate | null>(null)
    const bumpVersion = useTemplatePurchaseStore(store => store.bumpVersion)

    useEffect(() => {
        let active = true
        void getSharedTemplateAction(slug).then(result => {
            if (active) setTemplate(result)
        })
        return () => {
            active = false
        }
    }, [slug])

    useEffect(() => {
        let active = true
        let settled = false
        const startedAt = Date.now()

        const settle = () => {
            if (!active || settled) return
            settled = true
            clearInterval(timer)
            setState('ready')
            bumpVersion()
        }

        if (sessionId) {
            void confirmTemplatePurchaseAction(sessionId).then(result => {
                if (result.ok && result.entitled) settle()
            })
        }

        const timer = setInterval(async () => {
            if (!active || settled) return
            if (Date.now() - startedAt > GIVE_UP_MS) {
                clearInterval(timer)
                setState('timeout')
                return
            }

            const result = await getTemplateAccessAction(slug)
            if (result.ok && result.access === 'active') settle()
        }, POLL_INTERVAL_MS)

        return () => {
            active = false
            clearInterval(timer)
        }
    }, [slug, sessionId, bumpVersion])

    return { state, template }
}
