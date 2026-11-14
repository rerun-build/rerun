import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { EngineConnection } from '@/lib/engine/types'

// The door every server action of the app goes through to reach the machine. It takes no argument,
// so there is nothing for the browser to falsify: the workspace comes from the session, and the
// machine from the workspace. A Box id would only ever have been an authorization token here.
//
// It lives beside the session helpers rather than in workspace-engine.service on purpose: that
// service is pulled into the Trigger.dev bundle (trigger/seed-company-brain.ts), where `next/headers` does
// not exist. Only a request can answer this question, so only request code imports it.
export async function requireWorkspaceConnection(): Promise<EngineConnection> {
    return getWorkspaceConnection(await requireWorkspaceId())
}
