// Tests for scripts/self-host-check.mjs.
//
// The check runs as a subprocess with a fake Supabase (an HTTP server answering the
// check_email_exists RPC) and a fake `docker` on PATH, so no real Supabase or Docker
// is needed. The fake `docker` answers `ps` with a Kong container and `exec ... cat`
// for the template files, denying the names in FAKE_DOCKER_DENY the way a container
// that cannot read the files would.
//
//   node --test scripts/self-host-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./self-host-check.mjs', import.meta.url))
const NODE = process.execPath
const LOCAL_URL = 'http://localhost:54421'
// Treated as hosted by the check (no localhost/127.0.0.1 in it) but still reaches the
// fake server on this machine, so it stands in for a supabase.com project.
const HOSTED_URL = 'http://[::1]:54421'

const FAKE_DOCKER = `#!/bin/sh
# Fake \`docker\` for the self-host check tests. Logs every call, answers \`ps\` with a
# Kong container (plus an unrelated one, so the check must pick the right name), and
# answers \`exec ... cat\` for the template files, denying the names in FAKE_DOCKER_DENY.
echo "$@" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "ps" ]; then
  printf 'supabase_kong_otherproject\\nsupabase_kong_%s\\n' "$(basename "$PWD")"
  exit 0
fi
if [ "$1" = "exec" ]; then
  file="$4"
  name="$(basename "$file")"
  case " $FAKE_DOCKER_DENY " in
    *" $name "*) echo "cat: $file: Permission denied" >&2; exit 1 ;;
  esac
  printf '<html>%s</html>\\n' "$name"
  exit 0
fi
exit 0
`

async function startFakeSupabase(t) {
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/rest/v1/rpc/check_email_exists') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end('true')
            return
        }
        res.writeHead(404)
        res.end()
    })
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(54421, '::', resolve)
        })
    } catch (error) {
        if (error.code === 'EADDRINUSE') t.skip('port 54421 is in use (a real local Supabase is running)')
        throw error
    }
    t.after(() => {
        server.closeAllConnections()
        server.close()
    })
    return server
}

async function runCheck(t, { supabaseUrl, deny = '' }) {
    const dir = await mkdtemp(join(tmpdir(), 'self-host-check-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const bin = join(dir, 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 })
    const log = join(dir, 'docker.log')
    await writeFile(
        join(dir, '.env'),
        [
            'NEXT_PUBLIC_APP_URL=http://localhost:3000',
            `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
            'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test',
            'SUPABASE_SECRET_KEY=sb_secret_test',
            '',
        ].join('\n'),
    )
    const child = spawn(NODE, [SCRIPT], {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_DOCKER_LOG: log, FAKE_DOCKER_DENY: deny },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
        stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
        stderr += chunk
    })
    const code = await new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('close', resolve)
    })
    const calls = await readFile(log, 'utf8').catch(() => '')
    return { code, stdout, stderr, calls }
}

test('fails when Kong cannot read a sign-in template', async (t) => {
    await startFakeSupabase(t)
    const { code, stderr, calls } = await runCheck(t, { supabaseUrl: LOCAL_URL, deny: 'email_change.html' })
    assert.equal(code, 1)
    assert.match(stderr, /email_change\.html/)
    assert.doesNotMatch(stderr, /confirmation\.html/)
    assert.match(stderr, /chcon -t container_file_t/)
    assert.match(calls, /exec supabase_kong_self-host-check-/)
})

test('passes when Kong can read the templates', async (t) => {
    await startFakeSupabase(t)
    const { code, stdout, calls } = await runCheck(t, { supabaseUrl: LOCAL_URL })
    assert.equal(code, 0)
    assert.match(stdout, /\.env is ready and Supabase answers/)
    for (const template of ['confirmation.html', 'email_change.html', 'magic_link.html']) {
        assert.match(calls, new RegExp(`cat /home/kong/templates/email/${template}`))
    }
})

test('skips the template check for a hosted Supabase', async (t) => {
    await startFakeSupabase(t)
    const { code, stdout, calls } = await runCheck(t, { supabaseUrl: HOSTED_URL, deny: 'email_change.html' })
    assert.equal(code, 0)
    assert.match(stdout, /\.env is ready and Supabase answers/)
    assert.equal(calls, '')
})
