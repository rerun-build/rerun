export type PhoneStatus = 'none' | 'pending' | 'skipped' | 'unverifiable' | 'verified'

export const PHONE_ENABLED = false
export const PHONE_REQUIRED_MESSAGE = 'Confirm your phone number to keep going.'
export const PHONE_STATUS_COLUMNS = ['verified_at', 'skipped_at', 'unverifiable_at'] as const

export function phoneStatusOf(_row: { verified_at: string | null; skipped_at: string | null; unverifiable_at: string | null } | null): PhoneStatus {
    return 'none'
}

export const isPhoneStepDone = (status: PhoneStatus) => status === 'verified' || status === 'unverifiable'
