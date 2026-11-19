'use client'

import { useMemo } from 'react'

import { useForemanStore } from '@/stores/foreman.store'

// The arguments of every message that names the Chief of Staff: `named` picks the wording that
// uses the name the workspace gave it, or the default "Chief of Staff" one until there is a name.
export type ForemanNameValues = { named: 'yes' | 'no'; name: string }

export function useForemanName(): ForemanNameValues {
    const name = useForemanStore(state => state.name)
    return useMemo(() => ({ named: name ? 'yes' : 'no', name: name ?? '' }), [name])
}
