import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { PUBLIC_REPO, PUBLIC_REPOS, PUBLIC_URL } from './security-start.mjs'

const PRE_PUSH_PATH = fileURLToPath(new URL('./git-hooks/pre-push', import.meta.url))
const PRE_PUSH_PATTERN = (() => {
    const match = /points_to_public_repo\(\)\s*\{\s*printf '%s\\n' "\$1" \| grep -Eiq '([^']+)'/.exec(readFileSync(PRE_PUSH_PATH, 'utf8'))
    assert.ok(match, 'points_to_public_repo pattern found in pre-push')
    return match[1]
})()

function prePushMatches(url) {
    const probe = spawnSync('sh', ['-c', `points_to_public_repo() { printf '%s\\n' "$1" | grep -Eiq '${PRE_PUSH_PATTERN}'; }; points_to_public_repo "$1"`, 'sh', url], { encoding: 'utf8' })
    return probe.status === 0
}

const ACCEPTED_URLS = [
    'https://github.com/special-place-ai-heaven/moldwright',
    'https://github.com/special-place-ai-heaven/moldwright.git',
    'https://github.com/special-place-ai-heaven/moldwright/',
    'git@github.com:special-place-ai-heaven/moldwright.git',
    'ssh://git@github.com/special-place-ai-heaven/moldwright.git',
    'https://github.com/rerun-build/rerun',
    'https://github.com/rerun-build/rerun.git',
    'git@github.com:rerun-build/rerun.git',
]

const REJECTED_URLS = [
    'https://github.com/special-place-ai-heaven/moldwright-ghsa-1234-5678-9abc.git',
    'git@github.com:special-place-ai-heaven/moldwright-ghsa-1234-5678-9abc.git',
    'https://github.com/rerun-build/rerun-ghsa-1234-5678-9abc.git',
    'git@github.com:rerun-build/rerun-ghsa-1234-5678-9abc.git',
    'https://github.com/someone-else/moldwright.git',
    'https://github.com/someone-else/rerun.git',
    'no-push://this-workspace-holds-a-vulnerability-fix-push-to-the-advisory-fork',
    '',
]

describe('security tooling public repository matchers', () => {
    it('targets special-place-ai-heaven/moldwright for advisory API calls while keeping both public slugs', () => {
        assert.equal(PUBLIC_REPO, 'special-place-ai-heaven/moldwright')
        assert.deepEqual(PUBLIC_REPOS, ['special-place-ai-heaven/moldwright', 'rerun-build/rerun'])
    })

    it('accepts both public repository slugs in security-start and pre-push', () => {
        for (const url of ACCEPTED_URLS) {
            assert.equal(PUBLIC_URL.test(url), true, `PUBLIC_URL should accept ${url}`)
            assert.equal(prePushMatches(url), true, `points_to_public_repo should accept ${url}`)
        }
    })

    it('rejects advisory forks and unrelated repositories in security-start and pre-push', () => {
        for (const url of REJECTED_URLS) {
            assert.equal(PUBLIC_URL.test(url), false, `PUBLIC_URL should reject ${url}`)
            assert.equal(prePushMatches(url), false, `points_to_public_repo should reject ${url}`)
        }
    })
})
