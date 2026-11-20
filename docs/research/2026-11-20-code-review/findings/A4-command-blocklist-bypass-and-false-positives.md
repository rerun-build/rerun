# `A4`: `assertCommandAllowed` Regex Block-List in `sandbox.ts` Is Trivially Bypassed, False-Positives on Benign Filenames, and Never Runs on Claude Code or Codex Native Shells

- **Finding:** `assertCommandAllowed` (`apps/engine/src/tools/sandbox.ts:54-60`) is called *only* in `shell.ts:46` (never on Claude Code `Bash` or Codex CLI shell tools in `providers.ts`), false-positives on harmless commands like `cat shutdown.txt`, and is bypassed by flag reordering (`rm -fr /`), globbing (`rm -rf /*`), separate flags (`rm -r -f /`), argument reordering (`dd of=/dev/sda if=/dev/zero`), target paths (`rm -rf /data`), quoting (`r"m" -rf /`), or any interpreter (`python3`, `node`, `find -delete`).

## Evidence

- `apps/engine/src/tools/sandbox.ts:54-60`:
  ```ts
  const BLOCKED = [/\brm\s+-rf\s+\/(?:\s|$)/, /\bmkfs\b/, /\b(shutdown|halt|poweroff|kexec)\b/, /\b(?:tel)?init\s+[06]\b/, /\/sysrq-trigger/, /\bdd\s+if=.*of=\/dev\//, /:()\{\s*:\|:&\s*\};:/, /\bchown\s+-R\s+\/\s/]

  export function assertCommandAllowed(command: string): void {
      for (const pattern of BLOCKED) {
          if (pattern.test(command)) throw new Error(`Command blocked by policy: ${command}`)
      }
  }
  ```
- `apps/engine/src/tools/sandbox.test.ts:122-128` (the repo's own test suite already documents 4 rewrites that sail right past `BLOCKED`!):
  ```ts
    it.each(['rm -fr /', 'rm -r -f /', 'rm -rf /*', 'dd of=/dev/sda if=/dev/zero'])('does not catch the rewritten form %j', command => {
        expect(() => assertCommandAllowed(command)).not.toThrow()
    })

    it('blocks any command merely mentioning a power verb', () => {
        expect(() => assertCommandAllowed('cat shutdown.txt')).toThrow(/blocked by policy/)
    })
  ```
- SymForge `find_references` for `assertCommandAllowed`:
  - Only non-test caller in the entire repository: `apps/engine/src/tools/builtin/shell.ts:46`.
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/tools/sandbox.test.ts`
  ```text
   ✓ src/tools/sandbox.test.ts (passed)
  ```

## Trigger

Static bypass inventory across all 8 regexes in `BLOCKED` (`sandbox.ts:54`):
1. **Uncalled on primary coding/coworker providers:** `providers.ts:251` enables Claude Code's native `Bash` tool (`CLAUDE_RUN_TOOLS`) and Codex CLI's native shell (`providers.ts:177`), neither of which ever invokes `shell.ts` or `assertCommandAllowed`.
2. **Destructive `/data` wipe:** `rm -rf /data` (the one directory the `rerun` user actually owns and can wipe inside Docker!) is **allowed** even in its canonical `rm -rf` spelling because `BLOCKED[0]` checks only `/(\s|$)`.
3. **Flag/syntax rewrites on `/`:** `rm -fr /`, `rm -r -f /`, `rm --recursive --force /`, `rm -rf /*`, `rm -rf --no-preserve-root /`, `/bin/rm -rf /` (note `\b` still matches after `/`, so `/bin/rm -rf /` is caught, whereas `r'm' -rf /` or `\rm -fr /` or `find /data -delete` or `node -e "fs.rmSync('/data',{recursive:true,force:true})"` is not).
4. **False positives on prose/filenames:** `\b(shutdown|halt|poweroff|kexec)\b` and `\bmkfs\b` match anywhere in the command string, blocking `git commit -m "graceful shutdown"`, `rg halt src/`, or `cat shutdown.txt`!

## Impact and severity

- **Severity:** `medium` (standalone; compounds **Critical** `A1a` because `rm -rf /data` is completely allowed and `rerun` owns `/data`)
- **Impact:** Zero protection against `rm -rf /data` or Claude/Codex native shell commands, combined with annoying false-positive refusals whenever a `shell_exec` command grep/git-commits words like `shutdown` or `halt`.

## Proposed fix

- **Smallest causal change (`apps/engine/src/tools/sandbox.ts`, plus OS containment in `A1a`):**
  1. Replace reliance on regex containment with OS/mount isolation (`A1a`: read-only rootfs `--read-only` + `cap_drop: [ALL]` + `pids_limit: 512` in `docker-compose.yml` to block fork bombs `:(){ :|:& };:` and `mkfs`/`shutdown`/`dd of=/dev/*` at the kernel level, plus per-coworker UID/bind-mount scoping on `/data/agents/<id>`).
  2. As an ergonomic typo-guard against accidental LLM mistakes in `sandbox.ts:54`:
     - Catch `rm` flag permutations targeting `/` or `/data` (`/\brm\b[^\n;|&]*(?:\s-[a-zA-Z]*r[a-zA-Z]*f|\s-[a-zA-Z]*f[a-zA-Z]*r|\s--recursive)[^\n;|&]*\s\/(?:data(?:\s|\/?\*?$)|\*?(?:\s|$))/`).
     - Anchor power verbs (`shutdown|halt|poweroff|kexec`) to command position (`/(?:^|[;&|]\s*|(?:sudo|systemctl)\s+)(?:\/sbin\/|\/usr\/sbin\/)?(?:shutdown|halt|poweroff|kexec)\b/`) so `git commit -m "fix shutdown"` and `cat shutdown.txt` stop failing!
- **Must not break:** Legitimate `rm -rf ./dist`, `rm -rf /tmp/scratch`, `git commit -m "... shutdown ..."`, and `rg halt`.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/tools/sandbox.test.ts`
  - **Test name:** `it('blocks rm -fr / and rm -rf /data as typo guards while allowing shutdown in arguments')`
  - **Assertion:** Assert `assertCommandAllowed('rm -fr /')` and `assertCommandAllowed('rm -rf /data')` throw, while `assertCommandAllowed('git commit -m "clean shutdown"')` and `assertCommandAllowed('cat shutdown.txt')` do not throw.
- **Alternative fix and trade-off:** Wire the same typo-guard into Claude Code's `PreToolUse` callback in `providers.ts` so `Bash` calls get the same accidental `rm -rf /data` guardrail before OS sandboxing (`A1a`) is deployed.

## Confidence

`proven`
