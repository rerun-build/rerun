import { getBrand } from '@/lib/brand/server'
import { isWhiteLabel } from '@rerun/contracts'
import { LazyShowcase } from '@/components/onboarding/panels/LazyPanels'
import { internalPath } from '@/lib/auth/internal-path'
import { ownFactors, passkeyName } from '@/lib/auth/two-step/factors'
import { TWO_STEP_LAST_COOKIE } from '@/lib/auth/two-step/gate'
import { readTwoStep, writeTwoStep, writeTwoStepFlag } from '@/lib/auth/two-step/store'
import { routes } from '@/lib/routes'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getSigningInAccount } from '@/supabase/session/getServerSession'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { FullLoad } from './FullLoad'
import { TwoStepChallenge } from './TwoStepChallenge'

// The second step of the sign-in, where the proxy holds every page of an account with two-step until
// its session has been through one of its methods.
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const raw = (await searchParams).next
    const next = internalPath(typeof raw === 'string' ? raw : null, routes.home)
    const signingIn = await getSigningInAccount()
    if (!signingIn) redirect(routes.auth)
    // Nothing owed (any more): the token may still carry a flag turned off since, so out by a full load.
    if (!signingIn.pending) return <FullLoad to={next} />

    const { user } = signingIn
    const record = await readTwoStep(user.id)
    const factors = ownFactors(user, record)
    // The flag outlived the methods (removed by support from the auth dashboard): two-step is off, the
    // hub's recovery factor with it, or the auth server would still ask a second step of every client.
    if (!factors.length) {
        const admin = createServiceRoleClient().auth.admin.mfa
        for (const factor of user.factors ?? []) await admin.deleteFactor({ userId: user.id, id: factor.id })
        await writeTwoStep(user.id, null)
        await writeTwoStepFlag(user.id, false)
        return <FullLoad to={next} />
    }

    const app = factors.find(factor => factor.factor_type === 'totp')
    // A passkey opens the account on the hub's own address only, never on an organization's.
    const passkeysHere = !isWhiteLabel(await getBrand())
    const passkeys = factors
        .filter(factor => passkeysHere && factor.factor_type === 'webauthn')
        .sort((a, b) => (b.last_challenged_at ?? b.created_at).localeCompare(a.last_challenged_at ?? a.created_at))
        .map(factor => ({ id: factor.id, name: passkeyName(factor, record) }))
    const last = (await cookies()).get(TWO_STEP_LAST_COOKIE)?.value
    const first = passkeys.length && (last === 'passkey' || !app) ? 'passkey' : app ? 'app' : 'backup'

    return <TwoStepChallenge next={next} userId={user.id} appFactorId={app?.id ?? null} passkeys={passkeys} first={first} hasBackupCodes={!!record.codes?.length} panel={<LazyShowcase />} />
}
