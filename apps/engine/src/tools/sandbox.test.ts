import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-sandbox-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir, symlink, writeFile } = await import('node:fs/promises')
const { assertCommandAllowed, resolveInWorkspace, resolveWithin, resolveWithinReal } = await import('./sandbox.js')
const { workspaceDir } = await import('../config/paths.js')

const root = '/data/agents/a1/workspace'

describe('resolveWithin', () => {
    it.each([
        ['', root],
        ['.', root],
        ['notes.md', `${root}/notes.md`],
        ['a/../b.md', `${root}/b.md`],
        ['..notes.md', `${root}/..notes.md`],
        ['dir/..hidden/x', `${root}/dir/..hidden/x`],
        [`${root}/deep/file.txt`, `${root}/deep/file.txt`],
    ])('resolves %j inside the root', (path, expected) => {
        expect(resolveWithin(root, path)).toBe(expected)
    })

    it.each(['..', '../x', 'a/../../x', '/etc/passwd', '/data/agents/a1/workspace-other/x', '/data/agents/a1/.env'])('refuses %j', path => {
        expect(() => resolveWithin(root, path)).toThrow(`Path escapes the root: ${path}`)
    })
})

// A tree where every link leaves or stays inside a real root:
//   base/outside/secret.txt
//   base/root/inside/file.txt
//   base/root/link-out      -> base/outside
//   base/root/key-out       -> base/outside/secret.txt
//   base/root/link-in       -> base/root/inside/file.txt
//   base/root/dangling-out  -> base/outside/missing.txt
//   base/root/dangling-in   -> base/root/inside/missing.txt
//   base/root/loop-a        -> base/root/loop-b -> base/root/loop-a
//   base/rootlink           -> base/root
describe('resolveWithinReal', () => {
    const base = mkdtempSync(resolve(tmpdir(), 'rerun-sandbox-real-'))
    const outside = resolve(base, 'outside')
    const real = resolve(base, 'root')
    const rootlink = resolve(base, 'rootlink')

    beforeAll(async () => {
        await mkdir(outside, { recursive: true })
        await writeFile(resolve(outside, 'secret.txt'), 'secret')
        await mkdir(resolve(real, 'inside'), { recursive: true })
        await writeFile(resolve(real, 'inside/file.txt'), 'inside')
        await symlink(outside, resolve(real, 'link-out'))
        await symlink(resolve(outside, 'secret.txt'), resolve(real, 'key-out'))
        await symlink(resolve(real, 'inside/file.txt'), resolve(real, 'link-in'))
        await symlink(resolve(outside, 'missing.txt'), resolve(real, 'dangling-out'))
        await symlink(resolve(real, 'inside/missing.txt'), resolve(real, 'dangling-in'))
        await symlink(resolve(real, 'loop-b'), resolve(real, 'loop-a'))
        await symlink(resolve(real, 'loop-a'), resolve(real, 'loop-b'))
        await symlink(real, rootlink)
    })

    it.each(['link-out', 'link-out/secret.txt', 'key-out'])('refuses %j, a link that leaves the root', async path => {
        await expect(resolveWithinReal(real, path)).rejects.toThrow(`Path escapes the root: ${path}`)
    })

    it('refuses a tail that does not exist yet under a link that leaves the root', async () => {
        await expect(resolveWithinReal(real, 'link-out/new/file.txt')).rejects.toThrow('Path escapes the root: link-out/new/file.txt')
    })

    it('refuses a dangling link whose target would be outside the root', async () => {
        await expect(resolveWithinReal(real, 'dangling-out')).rejects.toThrow('Path escapes the root: dangling-out')
    })

    it('accepts a dangling link whose target would be inside the root', async () => {
        expect(await resolveWithinReal(real, 'dangling-in')).toBe(resolve(real, 'dangling-in'))
    })

    it('refuses a link loop', async () => {
        await expect(resolveWithinReal(real, 'loop-a')).rejects.toThrow()
    })

    it('returns the textual path for a link to a file inside the root', async () => {
        expect(await resolveWithinReal(real, 'link-in')).toBe(resolve(real, 'link-in'))
    })

    it('accepts a plain path, existing or not', async () => {
        expect(await resolveWithinReal(real, 'inside/file.txt')).toBe(resolve(real, 'inside/file.txt'))
        expect(await resolveWithinReal(real, 'new/deep/file.txt')).toBe(resolve(real, 'new/deep/file.txt'))
        expect(await resolveWithinReal(real, '')).toBe(real)
    })

    it('accepts a root that does not exist yet', async () => {
        const fresh = resolve(base, 'fresh-root')
        expect(await resolveWithinReal(fresh, 'a/b.txt')).toBe(resolve(fresh, 'a/b.txt'))
    })

    it('accepts an outgoing link itself when the last segment is not followed', async () => {
        expect(await resolveWithinReal(real, 'key-out', { followLast: false })).toBe(resolve(real, 'key-out'))
        expect(await resolveWithinReal(real, 'link-out', { followLast: false })).toBe(resolve(real, 'link-out'))
        await expect(resolveWithinReal(real, 'link-out/secret.txt', { followLast: false })).rejects.toThrow('Path escapes the root')
    })

    it('works when the root itself is a link', async () => {
        expect(await resolveWithinReal(rootlink, 'inside/file.txt')).toBe(resolve(rootlink, 'inside/file.txt'))
        expect(await resolveWithinReal(rootlink, 'link-in')).toBe(resolve(rootlink, 'link-in'))
        await expect(resolveWithinReal(rootlink, 'link-out/secret.txt')).rejects.toThrow('Path escapes the root: link-out/secret.txt')
    })

    it('keeps the textual message for a path that climbs out', async () => {
        await expect(resolveWithinReal(real, '../x')).rejects.toThrow('Path escapes the root: ../x')
        await expect(resolveWithinReal(real, outside)).rejects.toThrow(`Path escapes the root: ${outside}`)
    })
})

describe('resolveInWorkspace', () => {
    it('anchors on the agent workspace', async () => {
        expect(await resolveInWorkspace('a1', 'x.md')).toBe(resolve(workspaceDir('a1'), 'x.md'))
        await expect(resolveInWorkspace('a1', '../.env')).rejects.toThrow(/escapes the root/)
    })
})

describe('assertCommandAllowed', () => {
    it.each(['rm -rf /', 'sudo rm -rf / ', 'mkfs.ext4 /dev/sda1', 'shutdown -h now', 'halt', 'sudo poweroff', 'systemctl poweroff', 'sudo systemctl kexec', 'init 0', 'telinit 6', 'echo o > /proc/sysrq-trigger', 'dd if=/dev/zero of=/dev/sda', ':(){ :|:& };:', 'chown -R / nobody'])('blocks %j', command => {
        expect(() => assertCommandAllowed(command)).toThrow(`Command blocked by policy: ${command}`)
    })

    it.each(['ls -la', 'rm -rf ./build', 'rm -rf /tmp/scratch', 'npm run build', 'git status', 'curl -s https://example.com', 'sudo reboot'])('allows %j', command => {
        expect(() => assertCommandAllowed(command)).not.toThrow()
    })

    // A best-effort denylist, not a boundary: these are pinned so a change to it is deliberate.
    it.each(['rm -fr /', 'rm -r -f /', 'rm -rf /*', 'dd of=/dev/sda if=/dev/zero'])('does not catch the rewritten form %j', command => {
        expect(() => assertCommandAllowed(command)).not.toThrow()
    })

    it('blocks any command merely mentioning a power verb', () => {
        expect(() => assertCommandAllowed('cat shutdown.txt')).toThrow(/blocked by policy/)
    })
})
