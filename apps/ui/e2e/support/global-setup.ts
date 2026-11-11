import type { FullConfig } from '@playwright/test'

import { assertHubOnLocalStack, assertRunningHubIsLocal, readLocalStack } from './local-stack.cjs'

// `next dev` compiles a route on its first request. Compiled once here, before the workers start,
// rather than by every test that happens to open it first.
const WARM_ROUTES = ['/', '/auth/confirm']

export default async function globalSetup(config: FullConfig) {
    assertHubOnLocalStack(readLocalStack())
    assertRunningHubIsLocal(Number(process.env.CONDUCTOR_PORT ?? 3050))
    const baseURL = config.projects[0].use.baseURL
    for (const route of WARM_ROUTES) await fetch(`${baseURL}${route}`, { signal: AbortSignal.timeout(300_000) })
}
