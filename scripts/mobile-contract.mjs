#!/usr/bin/env node
// The contract the mobile builds in people's hands hold the hub to (apps/mobile/api-contract).
//
//   pnpm mobile:contract                                  writes current.json from the registry
//   pnpm mobile:contract:check                            current.json is up to date, and no shipped build breaks
//   pnpm mobile:contract:snapshot <ios|android> <build> [--commit <sha> | --src <dir>]
//                                                         freezes what one build reads: the registry of
//                                                         today with the schemas of the build's commit, or
//                                                         of a folder holding packages/contracts/src
//
// Every command reads the compiled registry: run `pnpm build:contracts` after changing it.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openApiOf } from './mobile-contract/openapi.mjs'
import { CACHE, CONTRACT_DIR, CURRENT, CURRENT_TITLE, json, loadContracts, ROOT, SHIPPED } from './mobile-contract/paths.mjs'
import { schemasAt } from './mobile-contract/schemas-at.mjs'

const OASDIFF_VERSION = '1.38.0'
const OASDIFF_ARCHIVES = {
    'darwin-arm64': ['darwin_all', '8a85428df3b00e76e7d41c49d222533c9beec813e9cbdc8162f3a6e776604c18'],
    'darwin-x64': ['darwin_all', '8a85428df3b00e76e7d41c49d222533c9beec813e9cbdc8162f3a6e776604c18'],
    'linux-x64': ['linux_amd64', '613037fd6a1d3362a1b742d6d86c338c0eb5ab3511f4942ce3948e78720ea2da'],
    'linux-arm64': ['linux_arm64', 'a5ebb16d90f729f6b436a92d3054c11ba5633ddfb639dfdfb64b0023cd03680c'],
}

async function currentDocument() {
    const { contracts, z } = await loadContracts()
    return openApiOf(z, contracts.mobileApi, contracts.hubErrorSchema, CURRENT_TITLE)
}

function oasdiffBinary() {
    const target = OASDIFF_ARCHIVES[`${process.platform}-${process.arch}`]
    if (!target) throw new Error(`No oasdiff build for ${process.platform}-${process.arch}`)
    const [suffix, sha256] = target
    const dir = path.join(CACHE, `oasdiff-${OASDIFF_VERSION}-${suffix}`)
    const binary = path.join(dir, 'oasdiff')
    if (existsSync(binary)) return binary
    mkdirSync(dir, { recursive: true })
    const archive = path.join(dir, 'oasdiff.tar.gz')
    execFileSync('curl', ['-fsSL', '-o', archive, `https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_${suffix}.tar.gz`], { stdio: 'inherit' })
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
    if (actual !== sha256) {
        rmSync(dir, { recursive: true, force: true })
        throw new Error(`oasdiff ${OASDIFF_VERSION}: checksum ${actual} instead of ${sha256}`)
    }
    execFileSync('tar', ['-xzf', archive, '-C', dir, 'oasdiff'])
    rmSync(archive)
    return binary
}

function shippedSnapshots() {
    if (!existsSync(SHIPPED)) return []
    return readdirSync(SHIPPED)
        .filter(file => /^(ios|android)-\d+\.json$/.test(file))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

async function generate() {
    mkdirSync(CONTRACT_DIR, { recursive: true })
    writeFileSync(CURRENT, json(await currentDocument()))
    console.log(`wrote ${path.relative(ROOT, CURRENT)}`)
}

function changesListed(file) {
    return readFileSync(file, 'utf8').split('\n').filter(line => line.trim() && !line.startsWith('#')).length
}

async function check() {
    const problems = []
    const fresh = json(await currentDocument())
    if (!existsSync(CURRENT) || readFileSync(CURRENT, 'utf8') !== fresh) problems.push(`${path.relative(ROOT, CURRENT)} is not what the registry says: run pnpm build:contracts && pnpm mobile:contract, and commit the file.`)

    const tmp = path.join(os.tmpdir(), `mobile-contract-${process.pid}.json`)
    writeFileSync(tmp, fresh)
    const binary = oasdiffBinary()
    const snapshots = shippedSnapshots()
    const ignoreList = path.join(os.tmpdir(), `mobile-contract-${process.pid}-ignore.txt`)
    const withKnownBreaks = []
    for (const file of snapshots) {
        // Each line names one change of oasdiff. `.adapted`: the hub answers this build differently, so it
        // still reads it. `.broken`: it breaks this build and no answer of the hub helps, until it retires.
        const [adapted, broken] = ['.adapted', '.broken'].map(kind => path.join(SHIPPED, file.replace(/\.json$/, kind)))
        const ignored = [adapted, broken].filter(existsSync)
        writeFileSync(ignoreList, ignored.map(list => readFileSync(list, 'utf8')).join('\n'))
        const ignore = ignored.length ? ['--err-ignore', ignoreList, '--warn-ignore', ignoreList] : []
        const result = spawnSync(binary, ['breaking', path.join(SHIPPED, file), tmp, '--fail-on', 'WARN', '--format', 'text', ...ignore], { encoding: 'utf8' })
        if (result.status === 0) {
            const knownBreaks = existsSync(broken) ? changesListed(broken) : 0
            if (knownBreaks) withKnownBreaks.push(file)
            console.log(knownBreaks ? `known ${file}: ${knownBreaks} breaks no answer can help, listed in ${path.basename(broken)}` : `ok    ${file}`)
            continue
        }
        console.log(`BREAK ${file}`)
        problems.push(`${file}: the hub would break this build\n${(result.stdout + result.stderr).trim()}`)
    }
    rmSync(tmp, { force: true })
    rmSync(ignoreList, { force: true })
    if (problems.length) {
        console.error(`\n${problems.join('\n\n')}\n\nA shipped build keeps the schemas it was compiled with: see apps/mobile/api-contract/README.md.`)
        process.exit(1)
    }
    const known = withKnownBreaks.length ? `, except for the breaks listed in the .broken of ${withKnownBreaks.length} of them` : ''
    console.log(`\nThe contract is up to date and the ${snapshots.length} shipped builds still read the hub${known}.`)
}

async function snapshot(platform, build, { commit, src }) {
    if (!['ios', 'android'].includes(platform) || !/^\d+$/.test(build ?? '')) throw new Error('usage: pnpm mobile:contract:snapshot <ios|android> <build> [--commit <sha> | --src <dir>]')
    const { contracts, z } = await loadContracts()
    const source = src ?? commit
    const endpoints = source ? await schemasAt(source, contracts, { root: ROOT, cache: CACHE }) : contracts.mobileApi
    const document = openApiOf(z, endpoints, contracts.hubErrorSchema, { title: 'Rerun mobile API', version: `${platform} ${build}${commit ? ` (${commit.slice(0, 8)})` : ''}` })
    mkdirSync(SHIPPED, { recursive: true })
    const file = path.join(SHIPPED, `${platform}-${build}.json`)
    // Frozen once written and only ever read by oasdiff: one line keeps a new build's file out of review.
    writeFileSync(file, `${JSON.stringify(document)}\n`)
    console.log(`wrote ${path.relative(ROOT, file)}`)
}

const [command, ...args] = process.argv.slice(2)
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
try {
    if (command === 'generate') await generate()
    else if (command === 'check') await check()
    else if (command === 'snapshot') await snapshot(args[0], args[1], { commit: flag('--commit'), src: flag('--src') })
    else throw new Error('usage: node scripts/mobile-contract.mjs generate | check | snapshot <ios|android> <build> [--commit <sha> | --src <dir>]')
} catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
}
