import { describe, expect, it } from 'vitest'
import { isInsideRemote, isReservedWindowsPath, isSensitiveRemotePath, normalizeRemotePath, remoteParentOf, resolveRemotePath } from '@rerun/contracts'
import { fileDecision } from './file-access.js'

const MAC_HOME = '/Users/claire'
const WIN_HOME = 'C:\\Users\\Claire'

describe('paths on a linked computer', () => {
    it('normalizes the way each system compares paths', () => {
        expect(normalizeRemotePath('~/Rushes/../Exports/./a.mp4', 'mac', MAC_HOME)).toBe('/users/claire/exports/a.mp4')
        expect(normalizeRemotePath('/home/Léa/Vidéos', 'linux', '/home/Léa')).toBe('/home/Léa/Vidéos')
        expect(normalizeRemotePath('C:\\Users\\Claire\\Videos\\', 'win', WIN_HOME)).toBe('c:/users/claire/videos')
        expect(normalizeRemotePath('\\\\nas\\share\\x', 'win', WIN_HOME)).toBe('//nas/share/x')
        expect(normalizeRemotePath('/../../etc/passwd', 'linux', '/home/a')).toBe('/etc/passwd')
    })

    it('tells inside from outside, never fooled by a sibling with the same start or by ..', () => {
        expect(isInsideRemote('/Users/claire/Rerun/a.mov', '/Users/claire/Rerun', 'mac', MAC_HOME)).toBe(true)
        expect(isInsideRemote('/Users/claire/Rerun', '/Users/claire/Rerun/', 'mac', MAC_HOME)).toBe(true)
        expect(isInsideRemote('/Users/claire/Rerun-old/a.mov', '/Users/claire/Rerun', 'mac', MAC_HOME)).toBe(false)
        expect(isInsideRemote('/Users/claire/Rerun/../.ssh/id_rsa', '/Users/claire/Rerun', 'mac', MAC_HOME)).toBe(false)
        expect(isInsideRemote('d:\\RUSHES\\day2.mov', 'D:\\Rushes', 'win', WIN_HOME)).toBe(true)
        expect(isInsideRemote('/home/a/Rushes/x', '/home/a/rushes', 'linux', '/home/a')).toBe(false)
    })

    it.each([
        ['~/.ssh/config', 'mac', MAC_HOME],
        ['/Users/claire/Library/Keychains/login.keychain-db', 'mac', MAC_HOME],
        ['/Users/claire/Library/Application Support/Google/Chrome/Default/Cookies', 'mac', MAC_HOME],
        ['~/.aws/credentials', 'linux', '/home/a'],
        ['/home/a/project/.env', 'linux', '/home/a'],
        ['/home/a/project/.env.production', 'linux', '/home/a'],
        ['/etc/shadow', 'linux', '/home/a'],
        ['C:\\Users\\Claire\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data', 'win', WIN_HOME],
        ['c:\\users\\claire\\appdata\\roaming\\mozilla\\firefox', 'win', WIN_HOME],
        ['C:\\Windows\\System32\\config\\SAM', 'win', WIN_HOME],
        ['D:\\keys\\server.pem', 'win', WIN_HOME],
        ['/Users/claire/Passwords.kdbx', 'mac', MAC_HOME],
    ] as const)('knows %s holds secrets', (path, os, home) => {
        expect(isSensitiveRemotePath(path, os, home)).toBe(true)
    })

    it.each([
        ['~/Rerun/teaser.mp4', 'mac', MAC_HOME],
        ['/Users/claire/Movies/day2.mov', 'mac', MAC_HOME],
        ['D:\\Rushes\\Vidéos été 2026\\day2.mov', 'win', WIN_HOME],
        ['/home/a/environment.md', 'linux', '/home/a'],
    ] as const)('lets %s be an ordinary file', (path, os, home) => {
        expect(isSensitiveRemotePath(path, os, home)).toBe(false)
    })

    it('knows the names Windows reserves and the network shares', () => {
        expect(isReservedWindowsPath('C:\\x\\CON')).toBe(true)
        expect(isReservedWindowsPath('nul.txt')).toBe(true)
        expect(isReservedWindowsPath('\\\\nas\\share\\a.mov')).toBe(true)
        expect(isReservedWindowsPath('C:\\x\\console.log')).toBe(false)
    })

    it('makes a path absolute against the working folder, the way the computer writes it', () => {
        expect(resolveRemotePath('Exports/a.mp4', '/Users/claire/Rerun', 'mac', MAC_HOME)).toBe('/Users/claire/Rerun/Exports/a.mp4')
        expect(resolveRemotePath('..\\Rushes', 'C:\\Users\\Claire\\Rerun', 'win', WIN_HOME)).toBe('C:\\Users\\Claire\\Rushes')
        expect(resolveRemotePath('~/x', '/w', 'linux', '/home/a')).toBe('/home/a/x')
        expect(resolveRemotePath('/abs/y', '/w', 'linux', '/home/a')).toBe('/abs/y')
        expect(remoteParentOf('C:\\Exports\\a.mp4')).toBe('C:\\Exports')
        expect(remoteParentOf('C:\\a.mp4')).toBe('C:\\')
        expect(remoteParentOf('/Users/claire/a.mp4')).toBe('/Users/claire')
    })
})

describe('fileDecision', () => {
    const view = (mode: 'ask' | 'remember' | 'full', allowedFolders: string[] = []) => ({ settings: { mode, unattended: true, allowedPrograms: [], allowedFolders, screenAlways: false }, facts: { os: 'mac', workDir: '/Users/claire/Rerun', homeDir: MAC_HOME, shell: 'zsh' } as never })

    it('lets the working folder and the folders always allowed through, in every mode', () => {
        expect(fileDecision(view('ask'), 'teaser.mp4', [])).toEqual({ kind: 'allowed', path: '/Users/claire/Rerun/teaser.mp4', roots: ['/Users/claire/Rerun'], sensitiveOk: false })
        expect(fileDecision(view('remember', ['/Volumes/Rushes']), '/Volumes/Rushes/day2.mov', [])).toMatchObject({ kind: 'allowed' })
    })

    it('asks for anywhere else, unless a yes covers it or the computer is in full access', () => {
        expect(fileDecision(view('remember'), '/Users/claire/Movies/a.mov', [])).toEqual({ kind: 'ask', path: '/Users/claire/Movies/a.mov', sensitive: false })
        expect(fileDecision(view('remember'), '/Users/claire/Movies/a.mov', ['/Users/claire/Movies'])).toMatchObject({ kind: 'allowed', roots: ['/Users/claire/Rerun', '/Users/claire/Movies'] })
        expect(fileDecision(view('remember'), '../Movies/a.mov', [])).toMatchObject({ kind: 'ask' })
        expect(fileDecision(view('full'), '/Users/claire/Movies/a.mov', [])).toEqual({ kind: 'allowed', path: '/Users/claire/Movies/a.mov', roots: null, sensitiveOk: false })
    })

    it('always asks where secrets live, full access included, and passes the yes on to the computer', () => {
        expect(fileDecision(view('full'), '~/.ssh/config', [])).toEqual({ kind: 'ask', path: '/Users/claire/.ssh/config', sensitive: true })
        expect(fileDecision(view('full'), '~/.ssh/config', ['~/.ssh/config'])).toMatchObject({ kind: 'allowed', sensitiveOk: true })
        expect(fileDecision(view('remember', ['/Users/claire']), '/Users/claire/.aws/credentials', [])).toMatchObject({ kind: 'ask', sensitive: true })
    })
})
