import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// `agents` holds the coworkers and, one per workspace, the Chief of Staff. A read that lists rows
// (the coworkers of a workspace, every recent one, a count) says which it wants with `kind`, or it
// would count the Chief of Staff against the plan, disable it, email about it, put it on the board.
// A read that names its rows (`id`, `space_id`, `template_id`, an engine id within a workspace)
// cannot pick it up by accident. The reads below take every kind on purpose.
const READS_EVERY_KIND: Record<string, string> = {
    'app/api/_services/agent.service.ts': 'a new handle must not take the Chief of Staff one',
    'ee/services/credit-usage.service.ts': 'the spend of the Chief of Staff is named like any other',
}

const APP_ROOT = path.resolve(import.meta.dirname, '../..')
const CLOUD_ROOTS = ['../../cloud/packages/cloud/src', '../../cloud/apps/admin'].map(dir => path.resolve(APP_ROOT, dir)).filter(existsSync)
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'cloud-oss'])

const FILTER_ARGUMENT: Record<string, number> = {
    selectSingle: 3,
    selectMaybeSingle: 3,
    selectFirst: 3,
    selectMany: 3,
    selectAll: 3,
    selectCount: 2,
    selectSingleWithJoins: 4,
    selectMaybeSingleWithJoins: 4,
    selectManyWithJoins: 4,
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        if (SKIPPED_DIRS.has(name)) return []
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) return sourceFiles(full)
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [full] : []
    })
}

// Every key a filter can carry, through the conditional spreads the readers write
// (`...(spaceId ? { space_id: spaceId } : {})`). Null when it is not written in place. A key that
// only asks for presence (`{ notNull: true }`) names no row, so it is left out.
function filterKeys(node: ts.Expression): Set<string>[] | null {
    if (ts.isParenthesizedExpression(node)) return filterKeys(node.expression)
    if (ts.isConditionalExpression(node)) {
        const [whenTrue, whenFalse] = [filterKeys(node.whenTrue), filterKeys(node.whenFalse)]
        return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null
    }
    if (!ts.isObjectLiteralExpression(node)) return null
    const own = new Set<string>()
    let variants: Set<string>[] = [own]
    for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property)) own.add(property.name.text)
        else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && !asksPresence(property.initializer)) own.add(property.name.text)
        else if (ts.isSpreadAssignment(property)) {
            const spread = filterKeys(property.expression)
            if (!spread) return null
            variants = variants.flatMap(variant => spread.map(keys => new Set([...variant, ...keys])))
        }
    }
    return variants.map(variant => new Set([...variant, ...own]))
}

function asksPresence(value: ts.Expression): boolean {
    return ts.isObjectLiteralExpression(value) && value.properties.some(property => property.name && ts.isIdentifier(property.name) && ['notNull', 'isNull', 'neq'].includes(property.name.text))
}

function namesItsRows(keys: Set<string>): boolean {
    if (keys.has('kind') || keys.has('id') || keys.has('space_id') || keys.has('template_id')) return true
    return keys.has('engine_agent_id') && keys.has('workspace_id')
}

type Read = { file: string; line: number; ok: boolean }

function agentReads(file: string): Read[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const reads: Read[] = []
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in FILTER_ARGUMENT) {
            const table = node.arguments[1]
            if (table && ts.isStringLiteral(table) && table.text === 'agents') {
                const filters = node.arguments[FILTER_ARGUMENT[node.expression.text]]
                const variants = filters ? filterKeys(filters) : null
                const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
                reads.push({ file, line, ok: !!variants && variants.every(namesItsRows) })
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return reads
}

describe('reads of agents', () => {
    const files = [APP_ROOT, ...CLOUD_ROOTS].flatMap(sourceFiles)
    const reads = files.flatMap(agentReads)

    it('finds the readers it checks', () => {
        expect(reads.length).toBeGreaterThan(40)
    })

    it('says which kind of row it lists, or names its rows', () => {
        const unfiltered = reads.filter(read => !read.ok && !(path.relative(APP_ROOT, read.file) in READS_EVERY_KIND)).map(read => `${path.relative(APP_ROOT, read.file)}:${read.line}`)
        expect(unfiltered).toEqual([])
    })

    it('keeps its exceptions to files that still read every kind', () => {
        const stale = Object.keys(READS_EVERY_KIND).filter(file => !reads.some(read => !read.ok && path.relative(APP_ROOT, read.file) === file))
        expect(stale).toEqual([])
    })
})
