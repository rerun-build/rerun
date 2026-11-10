import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { duplicateDescription, installDescription, shareInstallDescription } from './install-feedback'

const t = englishTranslator('templates.installFeedback')

type Installed = Parameters<typeof installDescription>[0]
type Shared = Parameters<typeof shareInstallDescription>[0]
type Duplicated = Parameters<typeof duplicateDescription>[0]

const installed = (patch: Partial<Installed>) => ({ imported: 2, inactive: 0, failed: [], warnings: [], ...patch }) as Installed

describe('install feedback', () => {
    it('reads the landing of a template in English as before', () => {
        expect(t('landed', { count: 1, title: 'Sales' })).toBe('1 coworker from "Sales" landed on your board')
        expect(t('landed', { count: 3, title: 'Sales' })).toBe('3 coworkers from "Sales" landed on your board')
        expect(t('alreadyOnBoard', { title: 'Sales' })).toBe('"Sales" is already on your board')
    })

    it('puts the inactive agents first, then what failed and the warnings', () => {
        const result = installed({ inactive: 1, failed: [{ name: 'Scout' }] as Installed['failed'], warnings: ['The webhook changed.'] })
        expect(installDescription(result, t)).toBe('1 of them are inactive: your plan has no free coworker slot. Scout could not be imported. The webhook changed.')
        expect(installDescription(installed({}), t)).toBe('Open one and start its installation: it connects what it needs with you.')
    })

    it('says a shared agent landed inactive', () => {
        expect(shareInstallDescription({ inactive: true, warnings: [] } as unknown as Shared, t)).toBe('It landed inactive: your plan has no free coworker slot.')
        expect(shareInstallDescription({ inactive: false, warnings: [] } as unknown as Shared, t)).toBe('Open it and start its installation: it connects what it needs with you.')
    })

    it('names the side effects of a copy', () => {
        const copy = (patch: Partial<Duplicated>) => ({ ok: true, agentId: 'a', agentName: 'Scout', inactive: false, schedules: [], triggers: [], ...patch }) as Duplicated
        expect(duplicateDescription(copy({ triggers: ['t1'], schedules: ['s1', 's2'] }), t)).toBe(
            "1 webhook got a new URL: point your services at the copy's own address. 2 schedules run on the copy too. Turn them off if the work should not happen twice."
        )
        expect(duplicateDescription(copy({ schedules: ['s1'] }), t)).toBe('1 schedule runs on the copy too. Turn it off if the work should not happen twice.')
        expect(duplicateDescription(copy({}), t)).toBe('It carries everything the original had and is ready to run.')
    })
})
