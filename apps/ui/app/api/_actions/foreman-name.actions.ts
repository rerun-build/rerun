'use server'

import { requireAdminContext } from '@/app/api/_auth/ownership'
import { failure, failureOf } from '@/lib/i18n/action-error'
import { FOREMAN_NAME_MAX, sanitizeForemanName } from '@/lib/foreman/name'
import { saveForemanName } from '@/lib/foreman/profile'
import type { ActionResult } from './space.actions'

/** Renames the Chief of Staff for the whole workspace. An empty name gives it back its default one. */
export async function renameForemanAction(raw: string): Promise<ActionResult<{ name: string | null }>> {
    try {
        const ctx = await requireAdminContext()
        const name = raw.trim() ? sanitizeForemanName(raw) : null
        if (raw.trim() && !name) return failure('foremanNameInvalid', { max: FOREMAN_NAME_MAX })
        await saveForemanName(ctx, name)
        return { ok: true, name }
    } catch (err) {
        return failureOf(err, 'saveForemanNameFailed')
    }
}
