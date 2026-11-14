#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS_PATH = 'scripts/git-hooks'

function git(...args) {
    try {
        return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
        return null
    }
}

function hasOwnHooks() {
    const commonDir = git('rev-parse', '--git-common-dir')
    const hooksDir = join(isAbsolute(commonDir) ? commonDir : join(REPO_ROOT, commonDir), 'hooks')
    return existsSync(hooksDir) && readdirSync(hooksDir).some((name) => !name.endsWith('.sample'))
}

function install() {
    if (git('rev-parse', '--is-inside-work-tree') !== 'true') return
    if (!existsSync(join(REPO_ROOT, HOOKS_PATH, 'pre-push'))) return

    const current = git('config', '--get', 'core.hooksPath')
    if (current === HOOKS_PATH) return
    if (current || hasOwnHooks()) {
        console.warn(`git hooks: this checkout runs hooks of its own, add ${HOOKS_PATH}/pre-push to them by hand.`)
        return
    }
    git('config', 'core.hooksPath', HOOKS_PATH)
}

install()
