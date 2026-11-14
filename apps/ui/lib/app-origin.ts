import { headers } from 'next/headers'
import { site } from '@/lib/site'

const CONFIGURED_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? site.url).replace(/\/$/, '')

export async function getAppOrigin(): Promise<string> {
    if (process.env.NODE_ENV !== 'development') return CONFIGURED_ORIGIN

    const host = (await headers()).get('host')
    return host ? `http://${host}` : CONFIGURED_ORIGIN
}
