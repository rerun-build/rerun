import type { GoalLineForm, GoalVerdict, RunGoal } from '@moldwright/contracts'

const REST_PATTERNS = {
    'pull-url': /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/,
    sha: /^[0-9a-f]{7,40}$/,
} as const

const READ_TAIL = 8000
const MAX_LAST_LINE = 2000
const QUOTE_CUT = 120
const REASON_MAX = 300

const REST_LABEL: Record<GoalLineForm['rest'], string> = {
    'pull-url': '<pull request url>',
    sha: '<commit>',
    sentence: '<one sentence>',
}

function restMatches(rest: GoalLineForm['rest'], text: string): boolean {
    if (rest === 'sentence') return text.trim().length > 0
    return REST_PATTERNS[rest].test(text)
}

function lastLine(answer: string): string {
    const lines = answer.slice(-READ_TAIL).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i]!.trim()
        if (t) return t
    }
    return ''
}

function cut(text: string, n: number): string {
    return text.length > n ? text.slice(0, n) : text
}

function formsText(goal: RunGoal): string {
    return goal.lastLineForms.map((f) => `${f.prefix}${REST_LABEL[f.rest]}`).join(', ')
}

export function checkGoal(goal: RunGoal, answer: string, turn: number): GoalVerdict {
    const line = lastLine(answer)
    const verdict = (met: boolean, reason: string): GoalVerdict => ({ turn, met, reason: cut(reason, REASON_MAX) })
    if (!line) return verdict(false, 'The answer has no non-empty line.')
    if (line.length > MAX_LAST_LINE) {
        return verdict(false, `The last line is over ${MAX_LAST_LINE} characters: ${cut(line, QUOTE_CUT)}`)
    }
    for (const form of goal.lastLineForms) {
        if (line.startsWith(form.prefix) && restMatches(form.rest, line.slice(form.prefix.length))) {
            return verdict(true, `The last line matches ${form.prefix}${REST_LABEL[form.rest]}.`)
        }
    }
    return verdict(false, `The last line matches none of ${formsText(goal)}. It reads: ${cut(line, QUOTE_CUT)}`)
}

export function goalFeedback(goal: RunGoal, verdict: GoalVerdict): string {
    const m = /(?:It reads|over \d+ characters): (.*)$/s.exec(verdict.reason)
    const quoted = m?.[1] ?? ''
    if (verdict.reason.startsWith('The last line is over')) {
        return `Your last line is over ${MAX_LAST_LINE} characters, the limit. Your answer must end with one last line, at most ${MAX_LAST_LINE} characters, in one of these forms: ${formsText(goal)}. Nothing may follow it, not even a tools line. Your answer ended with: ${quoted}. Write only that last line now; do not redo the work.`
    }
    return `Your answer must end with one last line in one of these forms: ${formsText(goal)}. Nothing may follow it, not even a tools line. Your answer ended with: ${quoted}. Write only that last line now; do not redo the work.`
}
