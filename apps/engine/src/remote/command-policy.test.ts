import { describe, expect, it } from 'vitest'
import { refusedCommand } from './command-policy.js'

describe('refusedCommand', () => {
    it.each([
        'sudo rm -rf /var/cache',
        'echo x && sudo apt install ffmpeg',
        'cd ~ ; doas reboot',
        'pkexec bash',
        'su -',
        'su root -c ls',
        'runas /user:Administrator cmd',
        'Start-Process powershell -Verb RunAs',
        "Start-Process cmd -Verb 'runas'",
        'gsudo choco install ffmpeg',
    ])('never raises privileges: %s', command => {
        expect(refusedCommand(command)).toMatch(/administrator/)
    })

    it.each(['rm -rf /', 'rm -rf ~', 'rm -fr $HOME/', 'rm -rf / --no-preserve-root', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/disk2', 'shutdown -h now', 'make build && reboot', 'nohup shutdown -r now', 'systemctl poweroff', '(halt)', 'diskutil eraseDisk APFS X disk2', 'format C: /q', 'Format-Volume -DriveLetter D', 'diskpart', 'Remove-Item -Recurse -Force C:\\', 'reg delete HKLM\\Software\\X', 'Stop-Computer', ':(){ :|:& };:'])(
        'never wipes a disk nor stops the computer: %s',
        command => {
            expect(refusedCommand(command)).toMatch(/wipe a disk/)
        },
    )

    it.each(['ffmpeg -i rush.mov out.mp4', 'rm -rf ./build', 'rm -rf ~/Rerun/tmp', 'echo sudoku', 'grep -r shutdown src', 'git commit -m "fix reboot loop"', 'cat halt.log', 'ls reboot-notes', 'python3 train.py --epochs 3', 'Get-ChildItem C:\\Users', 'git status', 'ls "Vidéos été 2026"', 'Remove-Item -Recurse .\\cache'])('lets an ordinary command go to the card: %s', command => {
        expect(refusedCommand(command)).toBeNull()
    })
})
