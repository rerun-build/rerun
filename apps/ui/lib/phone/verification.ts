export type VerificationChannel = 'sms' | 'whatsapp'

export const isVerificationChannel = (value: unknown): value is VerificationChannel => value === 'sms' || value === 'whatsapp'

export const VERIFICATION_CODE_LENGTH = 6

export const PHONE_REQUIRED_MESSAGE = 'Confirm your phone number to keep going.'

export type PhoneStatus = 'none' | 'pending' | 'skipped' | 'unverifiable' | 'verified'

export const PHONE_STATUS_COLUMNS = ['verified_at', 'skipped_at', 'unverifiable_at'] as const

export function phoneStatusOf(row: { verified_at: string | null; skipped_at: string | null; unverifiable_at: string | null } | null): PhoneStatus {
    if (!row) return 'none'
    if (row.verified_at) return 'verified'
    if (row.unverifiable_at) return 'unverifiable'
    return row.skipped_at ? 'skipped' : 'pending'
}

export const isPhoneStepDone = (status: PhoneStatus) => status === 'verified' || status === 'unverifiable'

export function verificationLanguage(acceptLanguage: string | null | undefined): string | null {
    const tag = (acceptLanguage ?? '')
        .split(',')
        .map(part => part.trim().split(';')[0])
        .find(Boolean)
    if (!tag) return null

    try {
        return new Intl.Locale(tag).baseName
    } catch {
        return null
    }
}
