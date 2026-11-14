import { AFFILIATE_REFERRAL_COOKIE, AFFILIATE_REFERRAL_METADATA_KEY } from '@rerun/contracts'
import { cookies } from 'next/headers'

export async function affiliateReferralMetadata(): Promise<Record<string, string>> {
    const referral = (await cookies()).get(AFFILIATE_REFERRAL_COOKIE)?.value
    return referral ? { [AFFILIATE_REFERRAL_METADATA_KEY]: referral } : {}
}
