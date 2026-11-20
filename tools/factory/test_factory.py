import contextlib, io, json, os, re, shutil, stat, subprocess, sys, tempfile, time, types, unittest
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import factory as F
import mirror

REPO = "rerun"
FULL = "special-place-ai-heaven/" + REPO


def git(cwd, *a, check=True):
    r = subprocess.run(["git", "-C", cwd] + list(a), capture_output=True, text=True)
    if check and r.returncode:
        raise AssertionError("git %s failed: %s" % (" ".join(a), r.stderr))
    return r.stdout.strip()


def write(d, name, text):
    with open(os.path.join(d, name), "w", newline="\n") as f:
        f.write(text)


def _writable(fn, p, *_):
    os.chmod(p, stat.S_IWRITE)
    fn(p)


class FactoryCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="factory-test-")
        self.addCleanup(shutil.rmtree, self.tmp, **({"onexc": _writable} if sys.version_info >= (3, 12) else {"onerror": _writable}))
        saved = {k: getattr(F, k) for k in ("GIT", "WORK", "REPOS", "WT", "STATE", "LOAD_PER_CPU")}
        self.addCleanup(lambda: [setattr(F, k, v) for k, v in saved.items()])
        F.GIT, F.WORK, F.LOAD_PER_CPU = "git", os.path.join(self.tmp, "work"), None
        F.REPOS, F.WT, F.STATE = F.WORK + "/repos", F.WORK + "/wt", F.WORK + "/state"
        os.makedirs(F.STATE)
        self.origin = os.path.join(self.tmp, "origin.git")
        git(self.tmp, "init", "--quiet", "--bare", self.origin)
        seed = self.make_clone("seed", init=True)
        write(seed, "README.md", "seed\n")
        git(seed, "add", "-A")
        git(seed, "commit", "--quiet", "-m", "seed")
        git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")
        self.clone = self.make_clone(os.path.join(F.REPOS, REPO))

    def make_clone(self, path, init=False):
        path = os.path.join(self.tmp, path)
        if init:
            git(self.tmp, "init", "--quiet", path)
        else:
            git(self.tmp, "clone", "--quiet", self.origin, path)
        for k, v in (("user.name", "factory-test"), ("user.email", "factory-test@localhost"), ("commit.gpgsign", "false")):
            git(path, "config", k, v)
        return path

    def wt(self, issue="7", chunk="1", base="dev"):
        path = os.path.join(F.WT, REPO, "%s-%s" % (issue, chunk))
        branch = "chunk/%s-%s" % (issue, chunk)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        git(self.clone, "worktree", "add", "--quiet", "-b", branch, path, "origin/" + base)
        git(self.clone, "config", "branch.%s.factorybase" % branch, base)
        return path

    def commit(self, path, name="work.txt", text="work\n"):
        write(path, name, text)
        git(path, "add", "-A")
        git(path, "commit", "--quiet", "-m", "work on " + name)
        return git(path, "rev-parse", "HEAD")

    def remote_sha(self, ref):
        return git(self.origin, "rev-parse", "--verify", "--quiet", ref, check=False)

    def remote_refs(self, prefix="refs/heads/rescue/"):
        return git(self.origin, "for-each-ref", "--format=%(refname)", prefix)

    def has_branch(self, branch="chunk/7-1"):
        return bool(git(self.clone, "branch", "--list", branch))

    def call(self, fn, argv):
        out, code = io.StringIO(), 0
        with contextlib.redirect_stdout(out):
            try:
                fn(argv)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()


class WtDoneSaves(FactoryCase):
    def test_unpushed_commits_are_pushed_to_a_rescue_branch_first(self):
        p = self.wt()
        sha = self.commit(p)
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remote_sha("refs/heads/rescue/chunk/7-1-" + sha[:8]), sha)
        self.assertIn("RESCUED", out)
        self.assertFalse(os.path.isdir(p))
        self.assertFalse(self.has_branch())

    def test_branch_without_worktree_dir_is_rescued_too(self):
        p = self.wt()
        sha = self.commit(p)
        git(self.clone, "worktree", "remove", "--force", p)
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remote_sha("refs/heads/rescue/chunk/7-1-" + sha[:8]), sha)
        self.assertFalse(self.has_branch())

    def test_failed_push_refuses_and_deletes_nothing(self):
        p = self.wt()
        self.commit(p)
        open(F.marker(REPO, "chunk/7-1"), "w").close()
        git(self.clone, "config", "remote.origin.pushurl", os.path.join(self.tmp, "nowhere.git"))
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertNotEqual(code, 0)
        self.assertIn("REFUSED", out)
        self.assertIn("Nothing deleted", out)
        self.assertTrue(os.path.isfile(os.path.join(p, "work.txt")))
        self.assertTrue(self.has_branch())
        self.assertTrue(os.path.exists(F.marker(REPO, "chunk/7-1")))

    def test_uncommitted_changes_refuse_and_deletes_nothing(self):
        p = self.wt()
        write(p, "README.md", "edited\n")
        write(p, "new.txt", "untracked\n")
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertNotEqual(code, 0)
        self.assertIn("uncommitted changes", out)
        with open(os.path.join(p, "README.md")) as f:
            self.assertEqual(f.read(), "edited\n")
        self.assertTrue(os.path.isfile(os.path.join(p, "new.txt")))
        self.assertTrue(self.has_branch())
        self.assertEqual(self.remote_refs(), "")

    def test_unreachable_origin_refuses_even_when_pushed(self):
        p = self.wt()
        self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        git(self.clone, "config", "remote.origin.url", os.path.join(self.tmp, "nowhere.git"))
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertNotEqual(code, 0)
        self.assertIn("cannot fetch origin", out)
        self.assertTrue(os.path.isdir(p))
        self.assertTrue(self.has_branch())

    def test_stale_tracking_ref_of_a_deleted_remote_branch_is_no_proof(self):
        p = self.wt()
        sha = self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        git(self.origin, "branch", "-D", "chunk/7-1")
        self.assertTrue(git(self.clone, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/chunk/7-1"))
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remote_sha("refs/heads/rescue/chunk/7-1-" + sha[:8]), sha)
        self.assertFalse(os.path.isdir(p))


def make_link(link, target):
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", os.path.normpath(link), os.path.normpath(target)], check=True, capture_output=True)
    else:
        os.symlink(target, link)


class WtDoneCleans(FactoryCase):
    def assert_gone(self, p, out):
        self.assertIn("removed worktree", out)
        self.assertFalse(os.path.isdir(p))
        self.assertFalse(self.has_branch())
        self.assertNotIn(os.path.basename(p), git(self.clone, "worktree", "list", "--porcelain"))
        self.assertFalse(os.path.exists(F.marker(REPO, "chunk/7-1")))
        self.assertEqual(self.remote_refs(), "")

    def test_clean_pushed_worktree_is_removed_and_link_targets_survive(self):
        p = self.wt()
        self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        shared = os.path.join(self.tmp, "shared_node_modules")
        os.makedirs(os.path.join(shared, "pkg"))
        write(shared, "keep.txt", "keep\n")
        with open(os.path.join(self.clone, ".git", "info", "exclude"), "a") as f:
            f.write("\nnode_modules\n")
        os.makedirs(os.path.join(p, "sub"))
        make_link(os.path.join(p, "node_modules"), shared)
        make_link(os.path.join(p, "sub", "node_modules"), shared)
        open(F.marker(REPO, "chunk/7-1"), "w").close()
        code, out = self.call(F.cmd_wt, ["done", REPO, "7", "1"])
        self.assertEqual(code, 0, out)
        self.assert_gone(p, out)
        self.assertTrue(os.path.isfile(os.path.join(shared, "keep.txt")))
        self.assertTrue(os.path.isdir(os.path.join(shared, "pkg")))

    def test_merge_dev_deletes_the_remote_branch_and_leaves_the_folder_to_the_janitor(self):
        p = self.wt()
        sha = self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        code, out = self.merge_dev(sha)
        self.assertEqual(code, 0, out)
        self.assertIn("MERGED", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")
        self.assertIn("folder %s/7-1 stays; the janitor removes it" % REPO, out)
        self.assertTrue(os.path.isdir(p))

    def test_merge_dev_keeps_a_dirty_worktree_and_still_reports_the_merge(self):
        p = self.wt()
        sha = self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        write(p, "left.txt", "left behind\n")
        code, out = self.merge_dev(sha)
        self.assertEqual(code, 0, out)
        self.assertIn("MERGED", out)
        self.assertNotIn("KEPT", out)
        self.assertTrue(os.path.isfile(os.path.join(p, "left.txt")))

    def merge_dev(self, sha):
        merger = self.make_clone("merger")
        pr = {"base": {"ref": "dev"}, "head": {"ref": "chunk/7-1", "sha": sha}, "state": "open", "draft": False, "merge_commit_sha": "0" * 40}
        real_run = F.run

        def fake_api(path, *a, **k):
            return [] if path.endswith("/files?per_page=100") else {"default_branch": "main"} if path == "repos/" + FULL else pr

        def fake_run(cmd, *a, **k):
            if cmd[-3].endswith("gate.py"):
                return subprocess.CompletedProcess(cmd, 0, "GATE PASS", "")
            if cmd[0] != F.GH:
                return real_run(cmd, *a, **k)
            if cmd[1:3] == ["pr", "merge"]:
                git(merger, "fetch", "--quiet", "origin")
                git(merger, "checkout", "--quiet", "-B", "dev", "origin/dev")
                git(merger, "merge", "--quiet", "--no-ff", "-m", "merge", "origin/chunk/7-1")
                git(merger, "push", "--quiet", "origin", "dev")
            elif "DELETE" in cmd:
                git(self.origin, "branch", "-D", "chunk/7-1")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        green = [{"name": "ci", "status": "completed", "conclusion": "success", "id": 1, "url": ""}]
        with mock.patch.dict(os.environ, {"FACTORY_DISPATCHER": "1"}), mock.patch.object(F, "api", fake_api), \
                mock.patch.object(F, "run", fake_run), mock.patch.object(F, "checks", lambda *a: green):
            return self.call(F.cmd_merge_dev, [REPO, "9"])


class MemInfo(FactoryCase):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(F, "MEMINFO", os.path.join(self.tmp, "no-meminfo"))
        p.start()
        self.addCleanup(p.stop)

    def test_meminfo_reader(self):
        self.assertIsNone(F.avail_mem_gb())
        write(self.tmp, "meminfo", "MemTotal:       16384000 kB\nMemFree:          100000 kB\nMemAvailable:   %8d kB\n" % (2 * 1048576))
        F.MEMINFO = os.path.join(self.tmp, "meminfo")
        self.assertEqual(F.avail_mem_gb(), 2.0)


@contextlib.contextmanager
def clone_fakes(case, gate=True):
    gh = os.path.join(case.tmp, "github.com", "special-place-ai-heaven")
    if not os.path.lexists(os.path.join(gh, "rerun.git")):
        os.makedirs(gh, exist_ok=True)
        os.symlink(case.origin, os.path.join(gh, "rerun.git"))
    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(mirror, "GITHUB", "file://" + case.tmp + "/github.com/"))
        stack.enter_context(mock.patch.object(F.shutil, "disk_usage", lambda p: types.SimpleNamespace(free=1000 * 2**30)))
        stack.enter_context(mock.patch.object(F, "du_gb", lambda p: 0.0))
        stack.enter_context(mock.patch.object(F, "MEMINFO", os.path.join(case.tmp, "no-meminfo")))
        if gate:
            stack.enter_context(mock.patch.object(F, "api", lambda *a, **k: {"default_branch": "main", "login": "factory-bot"}))
            stack.enter_context(mock.patch.object(F, "plan_check", lambda *a: None))
        yield


class WtRegister(FactoryCase):
    def setUp(self):
        super().setUp()
        for p in (mock.patch.object(F, "MEMINFO", os.path.join(self.tmp, "no-meminfo")),
                  mock.patch.dict(os.environ, {"FACTORY_OWNER": "", "FACTORY_RUN": ""})):
            p.start()
            self.addCleanup(p.stop)

    def new(self, chunk, *extra):
        with clone_fakes(self):
            return self.call(F.cmd_wt, ["new", REPO, "7", chunk] + list(extra))

    def record(self, chunk):
        with open(F.reg_path(REPO, "7-" + chunk)) as f:
            return json.load(f)

    def test_wt_new_writes_the_record(self):
        os.environ.update({"FACTORY_OWNER": "env-owner", "FACTORY_RUN": "run-42"})
        code, out = self.new("3", "--owner", "alice")
        self.assertEqual(code, 0, out)
        rec = self.record("3")
        created = rec.pop("created")
        self.assertEqual(rec, {"repo": FULL, "issue": "7", "chunk": "3", "branch": "chunk/7-3", "base": "dev", "owner": "alice", "run": "run-42", "checkout": "clone"})
        self.assertRegex(created, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertLess(abs(F.age_h({"created": created})), 0.02)
        self.new("3", "--owner", "bob")
        self.assertEqual(self.record("3")["owner"], "alice")

    def test_owner_from_environment_and_unknown_when_absent(self):
        self.new("3")
        self.assertEqual((self.record("3")["owner"], self.record("3")["run"]), ("unknown", "unknown"))
        os.environ["FACTORY_OWNER"] = "env-owner"
        self.new("4")
        self.assertEqual(self.record("4")["owner"], "env-owner")

    def test_wt_list_shows_owner_age_state_and_older_worktrees(self):
        self.new("3", "--owner", "alice")
        self.wt(chunk="1")
        open(F.marker(REPO, "chunk/7-1"), "w").close()
        with clone_fakes(self):
            code, out = self.call(F.cmd_wt, ["list"])
        self.assertEqual(code, 0, out)
        rows = dict(l.split("  ", 1) for l in out.splitlines() if l.startswith(REPO + "/"))
        self.assertRegex(rows[REPO + "/7-3"], r"owner alice  age 0h  ACTIVE builder$")
        self.assertRegex(rows[REPO + "/7-1"], r"owner unknown  age \?  CI green, waits for merge$")
        self.assertIn("active builders: 1 | 2 job folders", out)


class WtSweep(FactoryCase):
    def setUp(self):
        super().setUp()
        self.prs = {}

    def old_commit(self, path, name="work.txt"):
        write(path, name, "old work\n")
        git(path, "add", "-A")
        env = dict(os.environ, GIT_COMMITTER_DATE="2026-01-01T00:00:00Z", GIT_AUTHOR_DATE="2026-01-01T00:00:00Z")
        subprocess.run(["git", "-C", path, "commit", "--quiet", "-m", "old work"], check=True, env=env, capture_output=True)
        return git(path, "rev-parse", "HEAD")

    def pr(self, chunk, number, state, sha):
        self.prs.setdefault("chunk/7-" + chunk, []).append({"number": number, "state": state, "headRefOid": sha})

    def sweep(self, *argv):
        with mock.patch.object(F, "pr_lookup", lambda full, branch: self.prs.get(branch, [])):
            return self.call(F.cmd_wt, ["sweep"] + list(argv))

    def verdicts(self, out):
        return {l.split()[1]: l.split()[0] for l in out.splitlines() if l.split()[:1] in (["KEEP"], ["REMOVE"], ["RESCUE"])}

    def state_file(self, name, gate=False):
        d = os.path.join(F.STATE, "gate") if gate else F.STATE
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, name), "w").close()
        return os.path.join(d, name)

    def test_sweep_of_six_worktrees_fetches_origin_once(self):
        for c in "123456":
            p = self.wt(chunk=c)
            self.pr(c, 9, "MERGED", self.commit(p))
            git(p, "push", "--quiet", "origin", "chunk/7-" + c)
        fetches, real = [], F.run

        def counting(cmd, *a, **k):
            if "fetch" in cmd:
                fetches.append(cmd)
            return real(cmd, *a, **k)
        with mock.patch.object(F, "run", counting):
            code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(len(fetches), 1, fetches)
        self.assertEqual(out.count("REMOVE"), 7, out)

    def test_missing_shared_clone_is_kept_and_sweep_continues(self):
        p = self.wt()
        self.pr("1", 9, "MERGED", self.commit(p))
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        orphan = os.path.join(F.WT, "orphan", "r1183")
        os.makedirs(orphan)
        code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "REMOVE", "orphan/r1183": "KEEP"}, out)
        self.assertIn("no shared clone %s, cannot prove anything" % os.path.join(F.REPOS, "orphan"), out)
        self.assertTrue(os.path.isdir(orphan))
        self.assertFalse(os.path.exists(p))

    def behind_merged_head(self):
        p = self.wt(chunk="1")
        self.commit(p, "a.txt")
        head = self.commit(p, "b.txt")
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        git(p, "reset", "--quiet", "--hard", "HEAD~1")
        self.pr("1", 9, "MERGED", head)
        return p

    def test_worktree_behind_the_merged_pr_head_is_removed(self):
        self.behind_merged_head()
        code, out = self.sweep()
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "REMOVE"}, out)

    def test_worktree_behind_the_merged_pr_head_with_a_change_is_kept(self):
        p = self.behind_merged_head()
        write(p, "scratch.txt", "x\n")
        code, out = self.sweep()
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "KEEP"}, out)

    def test_dry_run_prints_verdicts_and_changes_nothing(self):
        p = self.wt(chunk="1")
        sha = self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        self.pr("1", 9, "MERGED", sha)
        code, out = self.sweep()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "REMOVE"})
        self.assertIn("dry run", out)
        self.assertTrue(os.path.isdir(p))
        self.assertTrue(self.has_branch("chunk/7-1"))

    def test_apply_removes_a_merged_worktree_and_only_its_state_files(self):
        p = self.wt(chunk="1")
        sha = self.commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        self.pr("1", 9, "MERGED", sha)
        mine = [self.state_file("ciwait__%s__9__%s.json" % (REPO, sha[:12])), self.state_file("%s-9-%s.json" % (REPO, sha), gate=True)]
        other = [self.state_file("ciwait__%s__91__%s.json" % (REPO, sha[:12])), self.state_file("%s-91-%s.json" % (REPO, sha), gate=True)]
        code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertIn("removed worktree", out)
        self.assertFalse(os.path.isdir(p))
        self.assertFalse(self.has_branch("chunk/7-1"))
        self.assertEqual([os.path.exists(f) for f in mine + other], [False, False, True, True])

    def test_apply_rescues_idle_unpushed_work_of_a_closed_pr_before_removing(self):
        p = self.wt(chunk="1")
        sha = self.old_commit(p)
        git(p, "push", "--quiet", "origin", "chunk/7-1")
        git(self.origin, "branch", "-D", "chunk/7-1")
        self.pr("1", 9, "CLOSED", sha)
        code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "RESCUE"})
        self.assertEqual(self.remote_sha("refs/heads/rescue/chunk/7-1-" + sha[:8]), sha)
        self.assertFalse(os.path.isdir(p))

    def test_apply_keeps_dirty_refused_and_fresh_worktrees_and_goes_on(self):
        dirty = self.wt(chunk="1")
        self.old_commit(dirty)
        write(dirty, "left.txt", "uncommitted\n")
        stuck = self.wt(chunk="2")
        stuck_sha = self.old_commit(stuck)
        merged = self.wt(chunk="3")
        sha = self.commit(merged)
        git(merged, "push", "--quiet", "origin", "chunk/7-3")
        self.pr("3", 11, "MERGED", sha)
        fresh = self.wt(chunk="4")
        recent = self.wt(chunk="5")
        self.commit(recent)
        reused = self.wt(chunk="6")
        self.pr("6", 5, "MERGED", "0" * 40)
        git(self.clone, "config", "remote.origin.pushurl", os.path.join(self.tmp, "nowhere.git"))
        code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "RESCUE", REPO + "/7-2": "RESCUE", REPO + "/7-3": "REMOVE",
                                              REPO + "/7-4": "KEEP", REPO + "/7-5": "KEEP", REPO + "/7-6": "KEEP"})
        self.assertIn("KEPT %s/7-1" % REPO, out)
        self.assertIn("KEPT %s/7-2" % REPO, out)
        self.assertEqual(git(stuck, "rev-parse", "HEAD"), stuck_sha)
        self.assertTrue(os.path.isfile(os.path.join(dirty, "left.txt")))
        self.assertFalse(os.path.isdir(merged))
        self.assertTrue(all(os.path.isdir(x) for x in (dirty, stuck, fresh, recent, reused)))
        self.assertIn("sweep: 3 KEEP, 1 REMOVE, 2 RESCUE", out)

    def test_open_pr_or_unreachable_github_keeps_even_when_idle(self):
        p = self.wt(chunk="1")
        sha = self.old_commit(p)
        self.pr("1", 9, "OPEN", sha)
        self.assertEqual(self.verdicts(self.sweep("--apply")[1]), {REPO + "/7-1": "KEEP"})
        self.prs = {}
        with mock.patch.object(F, "pr_lookup", lambda *a: None):
            code, out = self.call(F.cmd_wt, ["sweep", "--apply"])
        self.assertEqual(self.verdicts(out), {REPO + "/7-1": "KEEP"})
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(self.remote_refs(), "")


class PrLookupNoGh(unittest.TestCase):
    def test_missing_gh_gives_none(self):
        with mock.patch.object(F, "GH", "/nonexistent/gh"):
            self.assertIsNone(F.pr_lookup("o/r", "chunk/1-a"))


class WorkOverride(unittest.TestCase):
    def paths(self, env):
        code = "import sys; sys.path.insert(0, %r); import factory as F; print(F.WORK, F.REPOS, F.WT, F.STATE)" % HERE
        e = {k: v for k, v in os.environ.items() if k != "FACTORY_WORK"}
        e.update(env)
        return subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, env=e, check=True).stdout.split()

    def test_factory_work_moves_every_path_and_default_stays(self):
        self.assertEqual(self.paths({"FACTORY_WORK": "/tmp/fw"}), ["/tmp/fw", "/tmp/fw/repos", "/tmp/fw/wt", "/tmp/fw/state"])
        self.assertEqual(self.paths({}), ["/data/work", "/data/work/repos", "/data/work/wt", "/data/work/state"])

    def test_gate_has_no_own_work_path(self):
        with open(os.path.join(HERE, "gate.py"), encoding="utf-8") as f:
            self.assertNotIn("/data/work", f.read())


class PlanGate(FactoryCase):
    def new(self, body, comments):
        def fake_api(path, *a, **k):
            if path.endswith("/issues/7"):
                return body if body is None else {"body": body}
            if "/issues/7/comments" in path:
                return None if comments is None else [{"body": c} for c in comments]
            return {"default_branch": "main", "login": "factory-bot"}
        with clone_fakes(self, gate=False), mock.patch.object(F, "api", fake_api):
            code, out = self.call(F.cmd_wt, ["new", REPO, "7", "1"])
        return code, out, os.path.isdir(os.path.join(F.WT, REPO, "7-1"))

    def test_no_marker_refuses_and_makes_nothing(self):
        code, out, made = self.new("## Plan\nwe mention PLAN READY mid-line only", ["looks good"])
        self.assertEqual((code, made), (2, False), out)
        self.assertIn("no plan marker", out)
        self.assertFalse(self.has_branch())

    def test_plan_ready_in_a_comment_passes(self):
        code, out, made = self.new("work order", ["## Challenge", "all points accepted\nPLAN READY"])
        self.assertEqual((code, made), (0, True), out)

    def test_small_fix_in_the_body_passes(self):
        code, out, made = self.new("SMALL FIX: one-line SQL filter\n\ndetails", [])
        self.assertEqual((code, made), (0, True), out)

    def test_unreadable_github_refuses(self):
        for body, comments in ((None, []), ("PLAN READY", None)):
            code, out, made = self.new(body, comments)
            self.assertEqual((code, made), (2, False), out)
            self.assertIn("cannot read", out)


class PrOpenRetry(FactoryCase):
    def setUp(self):
        super().setUp()
        self.body = os.path.join(self.tmp, "body.md")
        write(self.tmp, "body.md", "\n\n".join(F.PR_HEADS) + "\n\nbody\n")
        self.creates = []
        self.created_bodies = []

    def pr_open(self, results):
        pending = list(results)
        path = self.wt("1572", "1")
        self.commit(path, "notes.txt", "x\n")
        git(path, "remote", "set-url", "origin", "https://github.com/" + FULL + ".git")
        git(path, "remote", "set-url", "--push", "origin", self.origin)
        issue = {"number": 1572, "body": "**Files**\n- `notes.txt`\n"}
        real_run = F.run

        def fake_run(cmd, *a, **k):
            if cmd[0] == F.GH and cmd[1:2] == ["api"]:
                return subprocess.CompletedProcess(cmd, 0, json.dumps(issue), "")
            if cmd[:3] == [F.GH, "pr", "create"]:
                self.creates.append(cmd)
                with open(cmd[cmd.index("--body-file") + 1]) as f:
                    self.created_bodies.append(f.read())
                rc, out, err = pending.pop(0)
                return subprocess.CompletedProcess(cmd, rc, out, err)
            if cmd[0] == F.GH:
                return subprocess.CompletedProcess(cmd, 0, "[]", "")
            if cmd[:2] == [F.GIT, "fetch"]:
                return subprocess.CompletedProcess(cmd, 0, "", "")
            return real_run(cmd, *a, **k)

        old = os.getcwd()
        os.chdir(path)
        self.addCleanup(os.chdir, old)
        real_sleep, waits = time.sleep, []

        def fake_sleep(seconds):
            if sys._getframe(1).f_code.co_filename == F.__file__:
                waits.append(seconds)
            else:
                real_sleep(seconds)

        with mock.patch.object(F, "run", fake_run), mock.patch.object(F.time, "sleep", fake_sleep):
            code, out = self.call(F.cmd_pr_open, ["--title", "T", "--body-file", self.body])
        return code, out, waits

    def test_pr_open_retries_when_github_says_submitted_too_quickly(self):
        slow = (1, "", "GraphQL: was submitted too quickly (createPullRequest)")
        code, out, sleeps = self.pr_open([slow, slow, (0, "https://github.com/x/y/pull/9\n", "")])
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.creates), 3)
        self.assertEqual(sleeps, [60, 120])
        self.assertIn("PR https://github.com/x/y/pull/9", out)

    def test_pr_open_gives_up_after_four_tries(self):
        slow = (1, "", "was submitted too quickly on three tries")
        code, out, sleeps = self.pr_open([slow] * 4)
        self.assertEqual(code, 1, out)
        self.assertEqual(len(self.creates), 4)
        self.assertEqual(sleeps, [60, 120, 240])
        self.assertIn("(tried 4 times over 7 minutes)", out)

    def test_pr_open_adds_the_closes_line_when_the_body_lacks_it(self):
        write(self.tmp, "body.md", "\n\n".join(F.PR_HEADS) + "\n\nbody\n")
        code, out, sleeps = self.pr_open([(0, "https://github.com/x/y/pull/9\n", "")])
        self.assertEqual(code, 0, out)
        self.assertTrue(self.created_bodies[0].rstrip().endswith("Closes #1572"), self.created_bodies[0])

    def test_pr_open_keeps_one_closes_line(self):
        write(self.tmp, "body.md", "\n\n".join(F.PR_HEADS) + "\n\nbody\n\nCloses #1572\n")
        code, out, sleeps = self.pr_open([(0, "https://github.com/x/y/pull/9\n", "")])
        self.assertEqual(code, 0, out)
        self.assertEqual(len(re.findall(r"(?mi)^Closes #1572\s*$", self.created_bodies[0])), 1, self.created_bodies[0])

    def test_pr_open_other_failure_is_not_retried(self):
        code, out, sleeps = self.pr_open([(1, "", "HTTP 422 Validation Failed")])
        self.assertEqual(code, 1, out)
        self.assertEqual(len(self.creates), 1)
        self.assertEqual(sleeps, [])
        self.assertNotIn("tried 4 times", out)


if __name__ == "__main__":
    unittest.main()
