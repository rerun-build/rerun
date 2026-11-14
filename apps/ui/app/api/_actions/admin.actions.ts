'use server'

import { getAdminEmail } from '@/lib/auth/admin'

export async function isAdminAction(): Promise<boolean> {
    return (await getAdminEmail()) !== null
}
