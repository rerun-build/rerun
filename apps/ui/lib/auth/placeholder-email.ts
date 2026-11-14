import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

const PLACEHOLDER_DOMAIN = 'phone.rerun.build'
const PLACEHOLDER_PATTERN = new RegExp(`^(\\d+)@${PLACEHOLDER_DOMAIN.replaceAll('.', '\\.')}$`)

export const placeholderEmailFor = (phone: string) => `${phone.replace(/\D/g, '')}@${PLACEHOLDER_DOMAIN}`

export const isPlaceholderEmail = (email: string | null | undefined) => !!email && PLACEHOLDER_PATTERN.test(email.toLowerCase())

const DELETED_ACCOUNT_DOMAIN = 'deleted.rerun.build'

export const deletedAccountEmailFor = (userId: string) => `${userId}@${DELETED_ACCOUNT_DOMAIN}`

export const isDeletedAccountEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${DELETED_ACCOUNT_DOMAIN}`)

export const realEmail = (email: string | null | undefined) => (email && !isPlaceholderEmail(email) && !isDeletedAccountEmail(email) ? email : null)

export function placeholderPhone(email: string | null | undefined): string | null {
    const digits = email ? PLACEHOLDER_PATTERN.exec(email.toLowerCase())?.[1] : undefined
    return digits ? `+${digits}` : null
}

export function accountLabel(email: string | null | undefined): string | null {
    if (!email) return null
    if (isDeletedAccountEmail(email)) return 'Deleted account'
    const phone = placeholderPhone(email)
    if (!phone) return email
    return parsePhoneNumberFromString(phone)?.formatInternational() ?? phone
}

export const isAppleRelayEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith('@privaterelay.appleid.com')
