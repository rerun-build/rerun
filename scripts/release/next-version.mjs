#!/usr/bin/env node
// The next open source version: the commits of the public master since the last version tag, the
// number they call for, and the release notes a self-hoster reads before updating.
//
//   node scripts/release/next-version.mjs [--to origin/master] [--from <tag or sha>]
//   node scripts/release/next-version.mjs --to <sha> --github-output   (the Version workflow)
//
// The number is a promise to the self-hoster:
//   patch  v0.10.1  the default: fixes, features, database migrations, security
//   minor  v0.11.0  the self-hoster edits something or cannot go back: docker-compose.yml, a required
//                   variable, an engine data-dir step; or a milestone, features piling up 14 days
//                   after the .0 of the series
//   major  v1.0.0   never computed: the day an update is guaranteed to need no manual step

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENGINE_LADDERS = ['apps/engine/src/datadir/migrations.ts', 'apps/engine/src/db/systemDb.ts', 'apps/engine/src/db/sharedDb.ts', 'apps/engine/src/db/brainDb.ts']
const MILESTONE_DAYS = 14
const NOT_SHIPPED = [/^\.claude\//, /^\.codex\//, /^\.github\//, /^[^/]+\.md$/, /\.test\.[cm]?[jt]sx?$/, /\/__snapshots__\//]

const { values: args } = parseArgs({
    options: {
        to: { type: 'string', default: 'origin/master' },
        from: { type: 'string' },
        'github-output': { type: 'boolean', default: false },
    },
})

const git = (gitArgs) => execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const lines = (text) => text.split('\n').filter(Boolean)

function parseSemver(tag) {
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
    return match ? match.slice(1).map(Number) : null
}

function versionTags(to) {
    return lines(git(['tag', '--merged', to, '--list', 'v*']))
        .filter(parseSemver)
        .sort((a, b) => {
            const [x, y] = [parseSemver(a), parseSemver(b)]
            return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
        })
}

const daysSince = (ref) => Math.floor((Date.now() - Date.parse(git(['log', '-1', '--format=%cI', ref]))) / 86_400_000)

function addedEnvVars(from, to) {
    const added = git(['diff', from, to, '--', '.env.example'])
        .split('\n')
        .map((line) => /^\+(#?)\s*([A-Z][A-Z0-9_]+)=/.exec(line))
        .filter(Boolean)
    return {
        required: added.filter((match) => !match[1]).map((match) => match[2]),
        optional: added.filter((match) => match[1]).map((match) => match[2]),
    }
}

function parseCommit(line) {
    const [sha, ...rest] = line.split(' ')
    const subject = rest.join(' ')
    const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject)
    if (!match) return { sha, subject, type: null }
    const [, type, scope, , text] = match
    return { sha, subject, type, scope, text: text.charAt(0).toUpperCase() + text.slice(1) }
}

function analyze() {
    git(['fetch', 'origin', '--tags', '--quiet'])
    const to = git(['rev-parse', '--verify', `${args.to}^{commit}`])
    const tags = versionTags(to)
    const lastTag = tags.at(-1) ?? null
    const from = args.from ?? lastTag
    if (!from) return { to, lastTag, from: null, commits: [] }

    const commits = lines(git(['log', '--no-merges', '--format=%h %s', `${from}..${to}`])).map(parseCommit)
    const shippedFiles = lines(git(['diff', '--name-only', from, to])).filter((path) => !NOT_SHIPPED.some((pattern) => pattern.test(path)))
    const migrations = lines(git(['diff', '--name-only', '--diff-filter=A', from, to, '--', 'supabase/migrations/']))
    const envVars = addedEnvVars(from, to)
    const ladders = lines(git(['diff', '--name-only', from, to, '--', ...ENGINE_LADDERS]))
    const compose = Boolean(git(['diff', '--name-only', from, to, '--', 'docker-compose.yml']))
    const features = commits.filter((commit) => commit.type === 'feat')

    const [major, minor, patch] = parseSemver(lastTag ?? 'v0.0.0')
    const seriesTag = `v${major}.${minor}.0`
    const daysSinceSeries = tags.includes(seriesTag) ? daysSince(seriesTag) : null
    const minorReasons = [
        compose && 'docker-compose.yml changed',
        envVars.required.length && `new required variable ${envVars.required.join(', ')}`,
        ladders.length && 'engine data-dir step',
        features.length && daysSinceSeries !== null && daysSinceSeries >= MILESTONE_DAYS && `milestone: ${features.length} features since ${seriesTag}, ${daysSinceSeries} days ago`,
    ].filter(Boolean)

    const bump = !shippedFiles.length ? null : minorReasons.length ? 'minor' : 'patch'
    const next = bump === 'minor' ? `v${major}.${minor + 1}.0` : bump === 'patch' ? `v${major}.${minor}.${patch + 1}` : null
    const reason = !commits.length
        ? 'nothing since the last version'
        : !bump
          ? 'nothing shipped: docs, CI, tooling and tests only'
          : bump === 'minor'
            ? `minor, ${minorReasons.join('; ')}`
            : 'patch, the default'

    return { to, lastTag, from, commits, shippedFiles, migrations, envVars, ladders, compose, features, bump, next, reason }
}

function releaseNotes({ commits, migrations, envVars, ladders, compose, bump }) {
    const bullets = (list) => list.map((commit) => `- ${commit.text}`)
    const highlights = bullets(commits.filter((commit) => commit.type === 'feat'))
    const fixes = bullets(commits.filter((commit) => commit.type === 'fix' || commit.type === 'perf'))

    const upgrade = [
        migrations.length && `- Database: ${migrations.length} new migration${migrations.length > 1 ? 's' : ''}. Run \`npx supabase@^2.113.0 db push\` before starting the new images.`,
        envVars.required.length && `- New required variable${envVars.required.length > 1 ? 's' : ''} in \`.env.example\`: ${envVars.required.map((name) => `\`${name}\``).join(', ')}. Set ${envVars.required.length > 1 ? 'them' : 'it'} before starting the new images.`,
        envVars.optional.length && `- New optional variable${envVars.optional.length > 1 ? 's' : ''} in \`.env.example\`: ${envVars.optional.map((name) => `\`${name}\``).join(', ')}.`,
        ladders.length && '- Engine: migrates its data directory on first start. Back it up first; there is no downgrade.',
        compose && '- `docker-compose.yml` changed: take the new one from this tag before pulling the images.',
    ].filter(Boolean)

    const summary =
        bump === 'minor'
            ? '> Minor release: read Upgrade before updating.'
            : migrations.length
              ? '> Patch release: apply the database migrations, then pull the new images.'
              : '> Patch release: pull the new images, nothing else to do.'

    const sections = [summary]
    if (highlights.length) sections.push(['## Highlights', ...highlights].join('\n'))
    if (fixes.length) sections.push(['## Fixes', ...fixes].join('\n'))
    if (!highlights.length && !fixes.length) sections.push('## Changes\n- Internal changes, nothing visible.')
    sections.push(['## Upgrade', ...(upgrade.length ? upgrade : ['- Nothing to do: pull the new images.'])].join('\n'))
    return `${sections.join('\n\n')}\n`
}

function writeGithubOutput(result) {
    const output = process.env.GITHUB_OUTPUT
    if (!output) throw new Error('--github-output runs in GitHub Actions: GITHUB_OUTPUT is not set')
    const delimiter = `NOTES_${Date.now()}`
    appendFileSync(output, `tag=${result.next ?? ''}\nsha=${result.to}\n`)
    if (result.next) appendFileSync(output, `notes<<${delimiter}\n${releaseNotes(result)}${delimiter}\n`)
}

function main() {
    const result = analyze()

    if (!result.from) {
        console.log('No version yet: the first one is v0.1.0, notes = initial public release.')
        return
    }

    console.log(`Last version: ${result.lastTag ?? '(given with --from)'}${result.lastTag ? `, ${daysSince(result.lastTag)} days ago` : ''}`)
    console.log(`Range: ${result.from}..${result.to.slice(0, 12)} (${args.to})\n`)
    console.log(`${result.commits.length} commits:`)
    for (const commit of result.commits) console.log(`  ${commit.sha} ${commit.subject}`)

    if (result.commits.length) {
        console.log('\nUpgrade:')
        console.log(`  Supabase migrations added: ${result.migrations.length ? '' : 'none'}`)
        for (const path of result.migrations) console.log(`    ${path}`)
        console.log(`  .env.example variables added: ${[...result.envVars.required, ...result.envVars.optional.map((name) => `${name} (optional)`)].join(', ') || 'none'}`)
        console.log(`  Engine data-dir ladders changed: ${result.ladders.length ? result.ladders.join(', ') : 'none'}`)
        console.log(`  docker-compose.yml changed: ${result.compose ? 'yes' : 'no'}`)
    }

    console.log(`\nNext version: ${result.next ?? '(none)'} (${result.reason})`)
    if (result.next) console.log(`\n--- notes ---\n${releaseNotes(result)}`)
    if (args['github-output']) writeGithubOutput(result)
}

main()
