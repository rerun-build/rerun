import type { CheckinEntry, CheckinReason } from '@rerun/contracts'
import type { Member } from '../db/repos/members.js'
import { buildScheduledRunMessage } from '../schedules/message.js'

const REASON_LINES: Record<CheckinReason, string> = {
    pulse: 'the daily look at the workspace found something worth a closer read',
    promise: 'a routine you set yourself to come back to something came due',
    manual: 'someone asked you to check in now',
}

const DAY_MS = 24 * 60 * 60_000

function localTime(timezone: string, now: Date): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

function dayOf(at: string, now: Date): string {
    const days = Math.floor((now.getTime() - Date.parse(at)) / DAY_MS)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

function lastWrote(member: Member, now: Date): string {
    const day = dayOf(member.lastSeenAt, now)
    return day === 'today' ? 'wrote today' : `last wrote ${day}`
}

function reportLine(report: CheckinEntry, members: Member[], now: Date): string {
    const reader = report.reportedTo ? (members.find(member => member.id === report.reportedTo)?.name ?? 'a member') : 'the owner'
    return `- ${dayOf(report.startedAt, now)}, for ${reader}: ${report.title}`
}

function memberLine(member: Member, now: Date): string {
    const name = member.name ?? 'A member'
    const where = member.timezone ? `it is ${localTime(member.timezone, now)} where they are (${member.timezone})` : 'their time zone is not known'
    const line = `- ${name} (id ${member.id}): ${where}, ${lastWrote(member, now)}`
    return member.instructions ? `${line}. Their own instructions to you, for whatever you write to them, over the first name and everything else about them:\n  """\n  ${member.instructions.split('\n').join('\n  ')}\n  """` : line
}

// The turn a check-in opens on, wrapped as a scheduled run so a chat draws it as a marker line and
// never as a message somebody typed. `promise` is the routine that asked for it, `reports` what its
// latest check-ins already told someone.
export function buildCheckinMessage({ slug, name, reason, members, promise, reports = [], now = new Date() }: { slug: string; name: string; reason: CheckinReason; members: Member[]; promise?: string; reports?: CheckinEntry[]; now?: Date }): string {
    const lines = [
        `This is a check-in: nobody wrote to you, you woke up because ${REASON_LINES[reason]}.`,
        members.length ? `The people who write in this workspace, the one who came by last first:\n${members.map(member => memberLine(member, now)).join('\n')}` : 'Nobody has written in this workspace yet.',
        reports.length ? `What your latest check-ins already told someone, the latest first:\n${reports.map(report => reportLine(report, members, now)).join('\n')}` : '',
        promise ? `What you said you would come back to:\n${promise.trim()}` : '',
    ]
    return buildScheduledRunMessage({ slug, name, body: lines.filter(Boolean).join('\n\n') })
}
