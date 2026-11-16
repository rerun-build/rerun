import errno, fcntl, os, re, subprocess, time
from unittest import mock

import test_factory as T
from test_clone_new import CloneCase, FULL

F = T.F


class JanitorCase(CloneCase):
    def setUp(self):
        super().setUp()
        import janitor
        self.J = janitor
        self.prs, self.issue = [], {"state": "open"}
        p = mock.patch.dict(os.environ, {"PATH": self.env["PATH"]})
        p.start()
        self.addCleanup(p.stop)
        for k, v in (("pr_lookup", lambda full, br: None if self.prs is None else list(self.prs)),
                     ("api", lambda path, *a, **k: self.issue if "/issues/" in path else {"default_branch": "main"})):
            p = mock.patch.object(F, k, v)
            p.start()
            self.addCleanup(p.stop)

    def job(self, chunk="1", hours=2):
        code, out = self.new(chunk)
        self.assertEqual(code, 0, out)
        p = self.folder(chunk)
        for k, v in (("user.name", "t"), ("user.email", "t@localhost"), ("commit.gpgsign", "false")):
            T.git(p, "config", k, v)
        with open(os.path.join(p, ".git", "factory-created"), "w") as f:
            f.write(str(int(time.time() - hours * 3600)))
        return p

    def merged(self, p, branch="chunk/7-1"):
        sha = self.commit(p, "w.txt")
        T.git(p, "push", "--quiet", "origin", branch)
        T.git(self.origin, "update-ref", "refs/heads/dev", sha)
        T.git(self.origin, "update-ref", "-d", "refs/heads/" + branch)
        self.prs = [{"number": 9, "state": "MERGED", "headRefOid": sha}]
        return sha

    def run_j(self, *a):
        return self.call(lambda _: self.J.main(list(a)), [])

    def trash(self):
        t = self.J.trash_root()
        return sorted(os.listdir(t)) if os.path.isdir(t) else []


class Janitor(JanitorCase):
    def test_a_merged_clean_pushed_clone_goes_to_the_trash_and_comes_back(self):
        p = self.job()
        self.merged(p)
        code, out = self.run_j("janitor", "--apply")
        self.assertEqual(code, 0, out)
        self.assertIn("REMOVE rerun/7-1  pull request merged", out)
        self.assertFalse(os.path.exists(p))
        [entry] = self.trash()
        code, out = self.run_j("restore", entry)
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.isdir(os.path.join(p, ".git")))

    def test_an_open_pull_request_keeps_it(self):
        p = self.job()
        self.prs = [{"number": 9, "state": "OPEN", "headRefOid": "x"}]
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  pull request open", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_held_lease_keeps_it_untouched(self):
        p = self.job()
        self.merged(p)
        with open(os.path.join(F.STATE, "jobs", "rerun-7-1.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  live: owned by run", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_process_working_inside_keeps_it(self):
        p = self.job()
        self.merged(p)
        s = subprocess.Popen(["sleep", "30"], cwd=p)
        self.addCleanup(s.kill)
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("a process works inside", out)
        self.assertTrue(os.path.isdir(p))

    def test_younger_than_an_hour_without_a_closed_pull_request_is_kept(self):
        p = self.job(hours=0)
        self.issue = {"state": "closed"}
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("younger than 1 h without a closed pull request", out)
        self.assertTrue(os.path.isdir(p))

    def test_stash_other_branch_and_detached_head_are_rescued_to_github_first(self):
        p = self.job()
        self.merged(p)
        self.issue = {"state": "closed"}
        T.write(p, "s.txt", "stashed\n")
        T.git(p, "add", "s.txt")
        T.git(p, "stash", "--quiet")
        stash = T.git(p, "rev-parse", "refs/stash")
        T.git(p, "checkout", "--quiet", "-b", "side")
        side = self.commit(p, "side.txt")
        T.git(p, "checkout", "--quiet", "--detach", "chunk/7-1")
        loose = self.commit(p, "loose.txt")
        code, out = self.run_j("janitor", "--apply")
        self.assertEqual(code, 0, out)
        for sha in (stash, side, loose):
            self.assertIn("RESCUED %s" % sha[:8], out)
            self.assertTrue(T.git(self.origin, "for-each-ref", "--contains", sha, "refs/heads/rescue/"))
        self.assertFalse(os.path.exists(p))

    def test_pushed_is_proved_against_github_not_the_configured_origin(self):
        p = self.job()
        self.merged(p)
        self.issue = {"state": "closed"}
        other = os.path.join(self.tmp, "fake-origin.git")
        T.git(self.tmp, "clone", "--quiet", "--bare", self.origin, other)
        T.git(p, "remote", "set-url", "origin", other)
        sha = self.commit(p, "only-in-fake.txt")
        T.git(p, "push", "--quiet", "origin", "chunk/7-1")
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("RESCUED %s" % sha[:8], out)
        self.assertTrue(T.git(self.origin, "for-each-ref", "--contains", sha, "refs/heads/rescue/"))

    def test_a_closed_pull_request_of_an_earlier_take_does_not_settle_a_folder_that_moved_on(self):
        p = self.job()
        take1 = self.commit(p, "take1.txt")
        T.git(p, "push", "--quiet", "origin", "chunk/7-1")
        self.prs = [{"number": 9, "state": "CLOSED", "headRefOid": take1}]
        self.commit(p, "take2.txt")
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1", out)
        self.assertNotIn("RESCUED", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_process_that_starts_inside_during_the_checks_keeps_it(self):
        p = self.job()
        self.merged(p)
        real = self.J.unpushed

        def arriving(path, full):
            s = subprocess.Popen(["sleep", "30"], cwd=path)
            self.addCleanup(s.wait)
            self.addCleanup(s.kill)
            return real(path, full)
        with mock.patch.object(self.J, "unpushed", arriving):
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("a process works inside", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_process_whose_folder_cannot_be_read_counts_as_working_inside(self):
        p = self.job()
        self.merged(p)
        real = os.readlink

        def unreadable(q, *a, **k):
            if q.startswith("/proc/%d/" % os.getpid()):
                raise OSError(errno.EIO, "input/output error")
            return real(q, *a, **k)
        with mock.patch.object(self.J.os, "readlink", unreadable):
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("a process works inside", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_failed_git_status_keeps_it(self):
        p = self.job()
        self.merged(p)
        fake = os.path.join(self.tmp, "gitstatus")
        T.write(self.tmp, "gitstatus", "#!/bin/sh\nif [ \"$1\" = status ]; then echo 'fatal: index file corrupt' >&2; exit 128; fi\nexec git \"$@\"\n")
        os.chmod(fake, 0o755)
        with mock.patch.object(F, "GIT", fake):
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  git status failed", out)
        self.assertTrue(os.path.isdir(p))

    def unsaved_file_keeps_it(self, name):
        p = self.job()
        self.merged(p)
        T.write(p, name, "unsaved\n")
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  uncommitted changes", out)
        with open(os.path.join(p, name)) as f:
            self.assertEqual(f.read(), "unsaved\n")

    def test_an_uncommitted_change_keeps_it(self):
        self.unsaved_file_keeps_it("README.md")

    def test_an_untracked_file_keeps_it(self):
        self.unsaved_file_keeps_it("new.txt")

    def test_a_failed_rescue_push_keeps_it(self):
        p = self.job()
        self.merged(p)
        self.issue = {"state": "closed"}
        sha = self.commit(p, "late.txt")
        T.write(os.path.join(self.origin, "hooks"), "pre-receive",
                "#!/bin/sh\nwhile read o n r; do case \"$r\" in refs/heads/rescue/*) echo no >&2; exit 1;; esac; done\n")
        os.chmod(os.path.join(self.origin, "hooks", "pre-receive"), 0o755)
        code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  commits on no GitHub branch and the rescue push failed", out)
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(T.git(p, "rev-parse", "HEAD"), sha)

    def test_a_fetch_refused_with_403_keeps_it(self):
        p = self.job()
        self.merged(p)
        fake = os.path.join(self.tmp, "git403")
        T.write(self.tmp, "git403", "#!/bin/sh\nif [ \"$1\" = fetch ]; then for a; do case \"$a\" in *github.com/*) "
                "echo \"fatal: unable to access '$a': The requested URL returned error: 403\" >&2; exit 128;; esac; done; fi\nexec git \"$@\"\n")
        os.chmod(fake, 0o755)
        with mock.patch.object(F, "GIT", fake):
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("KEEP   rerun/7-1  cannot fetch from GitHub", out)
        self.assertTrue(os.path.isdir(p))

    def test_a_refused_rebuild_does_not_stop_the_removals(self):
        a = self.job("1")
        self.merged(a)
        b = self.job("2")
        self.commit(b, "b.txt")
        T.git(b, "push", "--quiet", "origin", "chunk/7-2")
        import shutil
        shutil.rmtree(b)
        merged = self.prs
        with mock.patch.object(F, "pr_lookup", lambda full, br: list(merged) if br == "chunk/7-1" else []), \
                open(os.path.join(F.STATE, "jobs", "rerun-7-2.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("NOT REBUILT rerun/7-2", out)
        self.assertIn("REMOVE rerun/7-1", out)
        self.assertFalse(os.path.exists(a))

    def test_a_sigterm_during_a_rebuild_still_ends_the_janitor(self):
        b = self.job("2")
        self.commit(b, "b.txt")
        T.git(b, "push", "--quiet", "origin", "chunk/7-2")
        import shutil
        shutil.rmtree(b)
        with mock.patch.object(self.J.C, "new", side_effect=SystemExit(143)):
            code, out = self.run_j("janitor", "--apply")
        self.assertEqual(code, 143, out)
        self.assertNotIn("NOT REBUILT", out)

    def test_github_unreachable_keeps_everything_and_says_so_after_three_passes(self):
        p = self.job()
        self.prs = None
        for _ in range(3):
            code, out = self.run_j("janitor", "--apply")
        self.assertIn("JANITOR cannot reach GitHub for 3 passes", out)
        self.assertTrue(os.path.isdir(p))

    def test_the_trash_is_emptied_after_a_day_and_never_sooner(self):
        t = self.J.trash_root()
        for n in ("%d-rerun-1-1" % (time.time() - 25 * 3600), "%d-rerun-2-1" % time.time()):
            os.makedirs(os.path.join(t, n))
        self.run_j("janitor", "--apply")
        self.assertEqual([e.split("-", 1)[1] for e in self.trash()], ["rerun-2-1"])

    def test_git_prompts_are_off_for_every_git_call(self):
        self.assertEqual(os.environ.get("GIT_TERMINAL_PROMPT"), "0")


class Doctor(JanitorCase):
    def test_stale_git_locks_and_a_wrong_origin_are_repaired(self):
        p = self.job()
        lock = os.path.join(p, ".git", "index.lock")
        open(lock, "w").close()
        os.utime(lock, (time.time() - 7200, time.time() - 7200))
        T.git(p, "remote", "set-url", "origin", self.M.path("rerun"))
        code, out = self.run_j("doctor", "--apply")
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(lock))
        self.assertEqual(T.git(p, "remote", "get-url", "origin"), self.github + FULL + ".git")

    def test_a_live_folder_is_never_touched(self):
        p = self.job()
        lock = os.path.join(p, ".git", "index.lock")
        open(lock, "w").close()
        os.utime(lock, (time.time() - 7200, time.time() - 7200))
        with open(os.path.join(F.STATE, "jobs", "rerun-7-1.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            code, out = self.run_j("doctor", "--apply")
        self.assertIn("SKIP   rerun/7-1  live", out)
        self.assertTrue(os.path.exists(lock))

    def test_a_broken_clone_of_a_live_job_goes_to_the_trash_and_is_rebuilt_from_its_pushed_branch(self):
        p = self.job()
        sha = self.commit(p, "w.txt")
        T.git(p, "push", "--quiet", "origin", "chunk/7-1")
        os.remove(os.path.join(p, ".git", "HEAD"))
        code, out = self.run_j("doctor", "--apply")
        self.assertEqual(code, 0, out)
        self.assertIn("BROKEN rerun/7-1 moved to", out)
        self.assertIn("REBUILT rerun/7-1 from the pushed branch chunk/7-1", out)
        self.assertEqual(T.git(p, "rev-parse", "HEAD"), sha)
        self.assertEqual(len(self.trash()), 1)

    def test_a_broken_folder_with_unpushed_work_stays_in_the_trash_until_a_person_removes_it(self):
        p = self.job()
        sha = self.commit(p, "unpushed.txt")
        os.remove(os.path.join(p, ".git", "HEAD"))
        code, out = self.run_j("doctor", "--apply")
        self.assertIn("kept until a person removes it", out)
        [entry] = self.trash()
        old = re.sub(r"\d+", str(int(time.time() - 25 * 3600)), entry, count=1)
        os.rename(os.path.join(self.J.trash_root(), entry), os.path.join(self.J.trash_root(), old))
        self.run_j("janitor", "--apply")
        self.assertEqual(self.trash(), [old])
        code, out = self.run_j("restore", old)
        self.assertEqual(code, 0, out)
        T.write(os.path.join(p, ".git"), "HEAD", "ref: refs/heads/chunk/7-1\n")
        self.assertEqual(T.git(p, "rev-parse", "HEAD"), sha)

    def test_a_merged_job_is_not_rebuilt(self):
        p = self.job()
        self.merged(p)
        os.remove(os.path.join(p, ".git", "HEAD"))
        code, out = self.run_j("doctor", "--apply")
        self.assertNotIn("REBUILT", out)
        self.assertFalse(os.path.exists(p))

    def test_temporary_folders_of_dead_commands_are_removed_and_never_counted_as_jobs(self):
        t = os.path.join(F.WORK, "tmp", "rerun-7-1")
        os.makedirs(t)
        self.assertEqual(F.wt_dirs(), [])
        code, out = self.run_j("doctor", "--apply")
        self.assertIn("TMP rerun-7-1 removed", out)
        self.assertFalse(os.path.exists(t))

    def test_the_temporary_folder_of_a_live_job_is_kept(self):
        t = os.path.join(F.WORK, "tmp", "rerun-7-1")
        os.makedirs(t)
        os.makedirs(os.path.join(F.STATE, "jobs"), exist_ok=True)
        with open(os.path.join(F.STATE, "jobs", "rerun-7-1.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            code, out = self.run_j("doctor", "--apply")
        self.assertNotIn("TMP rerun-7-1", out)
        self.assertTrue(os.path.exists(t))

    def test_a_fault_on_one_folder_is_reported_and_exits_1(self):
        self.job()
        with mock.patch.object(self.J, "check_one", side_effect=RuntimeError("boom")):
            code, out = self.run_j("doctor", "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("DOCTOR FAULT rerun/7-1: boom", out)
