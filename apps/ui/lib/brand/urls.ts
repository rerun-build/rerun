import type { Brand } from '@rerun/contracts'
import { APP_URL } from '@/lib/app-url'

// Where the links of an email lead: the app of the brand it is sent for.
export function brandAppUrl(_brand: Brand): string {
    return APP_URL
}
