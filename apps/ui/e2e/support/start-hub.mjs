// The hub the end-to-end suite runs against, on the local stack and without the Supabase, Stripe or
// Bird variables the shell may export: `next dev` on a laptop, or with `--built` the output of
// `next build`, as CI serves it.

import { spawn } from 'node:child_process'

import { cleanServerEnv, UI_DIR } from './local-stack.cjs'

const [port, mode] = process.argv.slice(2)
const nextCommand = mode === '--built' ? 'start' : 'dev'
const hub = spawn('pnpm', ['exec', 'next', nextCommand, '-p', port], { cwd: UI_DIR, env: cleanServerEnv(), stdio: 'inherit' })
hub.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.kill(signal))
