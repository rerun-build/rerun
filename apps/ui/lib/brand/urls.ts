import type { Brand } from '@rerun/contracts'
import { APP_URL } from '@/lib/app-url'

// Where a link written for someone else to open leads: the app of the brand it is sent for.
export function brandAppUrl(brand: Brand): string {
    return brand.appUrl ?? APP_URL
}
