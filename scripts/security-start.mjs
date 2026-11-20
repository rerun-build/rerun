#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// @preserve Matched against points_to_public_repo in scripts/git-hooks/pre-push: update both files on rename.
export const PUBLIC_REPO = 'special-place-ai-heaven/moldwright'
export const PUBLIC_REPOS = [PUBLIC_REPO, 'rerun-build/rerun']
export const PUBLIC_URL = new RegExp(`github\\.com[:/](?:${PUBLIC_REPOS.map(slug => slug.replace(/\//g, '\\/')).join('|')})(\\.git)?\\/?$`, 'i')
const BLOCKED_PUSH_URL = 'no-push://this-workspace-holds-a-vulnerability-fix-push-to-the-advisory-fork'
const SEVERITIES = ['low', 'medium', 'high', 'critical']
const FORK_READY_ATTEMPTS = 30
const FORK_READY_DELAY_MS = 2000

const USAGE = `Usage:
  pnpm security:start "<title>" [--severity low|medium|high|critical]
  pnpm security:start --advisory GHSA-xxxx-xxxx-xxxx`

function fail(message) {
    console.error(message)
    process.exit(1)
}

function run(command, args, input) {
    return execFileSync(command, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] }).trim()
}

function git(...args) {
    return run('git', args)
}

function gitSucceeds(...args) {
    return spawnSync('git', args, { stdio: 'ignore' }).status === 0
}

function gitValue(...args) {
    return gitSucceeds(...args) ? git(...args) : ''
}

function ghApi(method, path, body) {
    const args = ['api', '-X', method, path]
    if (body) args.push('--input', '-')
    try {
        return JSON.parse(run('gh', args, body ? JSON.stringify(body) : undefined))
    } catch {
        fail(`gh api ${method} ${path} failed (see above).`)
    }
}

function parseArgs(argv) {
    const options = { severity: 'high', advisory: null, title: [] }
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index]
        if (arg === '--help' || arg === '-h') fail(USAGE)
        else if (arg === '--severity') options.severity = argv[++index]
        else if (arg === '--advisory') options.advisory = argv[++index]
        else options.title.push(arg)
    }
    const title = options.title.join(' ').trim()
    if (!options.advisory && !title) fail(USAGE)
    if (!SEVERITIES.includes(options.severity)) fail(`--severity is one of ${SEVERITIES.join(', ')}.`)
    return { ...options, title }
}

function checkWorkspace() {
    if (!gitSucceeds('rev-parse', '--is-inside-work-tree')) fail('Run it inside a checkout of the repository.')
    const originUrl = gitValue('remote', 'get-url', 'origin')
    if (!PUBLIC_URL.test(originUrl)) fail(`origin is not ${PUBLIC_REPOS.join(' or ')} (${originUrl || 'no origin'}).`)

    const existing = gitValue('config', '--get', 'rerun.securityAdvisory')
    if (existing) fail(`This workspace already holds the fix of ${existing}. Start another one in a new workspace.`)

    const branch = git('branch', '--show-current')
    if (branch && git('ls-remote', '--heads', 'origin', branch)) {
        fail(`The branch ${branch} is already on the public repository, so it is public. Start from a new workspace.`)
    }
    return originUrl
}

function openAdvisory({ advisory, title, severity }) {
    if (advisory) return ghApi('GET', `repos/${PUBLIC_REPO}/security-advisories/${advisory}`)
    return ghApi('POST', `repos/${PUBLIC_REPO}/security-advisories`, {
        summary: title,
        description: 'To be completed: what is affected, how it can be exploited, and how the fix closes it.',
        severity,
        vulnerabilities: [{ package: { ecosystem: 'other', name: 'rerun' } }],
    })
}

function forkCloneUrl(fullName, originUrl) {
    const usesSsh = /^(git@|ssh:\/\/)/i.test(originUrl)
    return usesSsh ? `git@github.com:${fullName}.git` : `https://github.com/${fullName}.git`
}

function privateFork(advisory, originUrl) {
    const fork = advisory.private_fork ?? ghApi('POST', `repos/${PUBLIC_REPO}/security-advisories/${advisory.ghsa_id}/forks`)
    return { ...fork, clone_url: forkCloneUrl(fork.full_name, originUrl) }
}

function probeFork(cloneUrl) {
    const probe = spawnSync('git', ['ls-remote', '--exit-code', '--heads', cloneUrl], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
    return { status: probe.status, stderr: (probe.stderr ?? '').trim() }
}

function waitForFork(cloneUrl) {
    let lastStderr = ''
    for (let attempt = 0; attempt < FORK_READY_ATTEMPTS; attempt++) {
        const { status, stderr } = probeFork(cloneUrl)
        if (status === 0) return
        const forkNotVisibleYet = status === 2 || /not found/i.test(stderr)
        if (!forkNotVisibleYet) fail(`Cannot reach the private fork ${cloneUrl}:\n${stderr}\nCheck your GitHub credentials for that URL.`)
        lastStderr = stderr
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, FORK_READY_DELAY_MS)
    }
    const details = lastStderr ? `\n${lastStderr}` : ''
    fail(`The private fork ${cloneUrl} is still empty.${details}\nRun the command again with --advisory in a minute.`)
}

function lockWorkspace(ghsaId, cloneUrl) {
    const remote = ghsaId.toLowerCase()
    if (gitValue('config', '--get', '--type=bool', 'extensions.worktreeConfig') !== 'true') {
        git('config', 'extensions.worktreeConfig', 'true')
    }
    git('config', '--worktree', `remote.${remote}.url`, cloneUrl)
    git('config', '--worktree', `remote.${remote}.fetch`, `+refs/heads/*:refs/remotes/${remote}/*`)
    git('config', '--worktree', 'remote.pushDefault', remote)
    git('config', '--worktree', 'remote.origin.pushurl', BLOCKED_PUSH_URL)
    git('config', '--worktree', 'rerun.securityAdvisory', ghsaId)
    git('fetch', '--quiet', remote)
    return remote
}

function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv)
    const originUrl = checkWorkspace()
    const advisory = openAdvisory(options)
    if (advisory.state !== 'draft' && advisory.state !== 'triage') {
        fail(`${advisory.ghsa_id} is ${advisory.state}: only a draft or triaged advisory takes a fix.`)
    }
    const fork = privateFork(advisory, originUrl)
    waitForFork(fork.clone_url)
    const remote = lockWorkspace(advisory.ghsa_id, fork.clone_url)

    console.log(`
Advisory ${advisory.ghsa_id} (${advisory.state}, private): ${advisory.html_url}
Private fork: ${fork.html_url}

This workspace now pushes to the remote ${remote} and can no longer push to ${PUBLIC_REPO}.

Next:
  1. Write the fix and run the tests locally: GitHub Actions does not run in an advisory fork.
  2. git push
  3. gh pr create --repo ${fork.full_name} --base dev
  4. Once Rerun Cloud runs the fix, merge and publish from the advisory page.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
}
