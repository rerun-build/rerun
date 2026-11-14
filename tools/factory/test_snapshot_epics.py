import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


def body(paths=(), parent=None):
    text = "**Depends on**: none\n"
    if parent:
        text += "**Part of**: #%d\n" % parent
    if paths:
        text += "**Files**\n" + "".join("- `%s`\n" % p for p in paths)
    return text


class Epics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "l.db")
        self.st = ledger_store.Store(self.path)
        self.addCleanup(self.close_main)
        self.calls = []

    def close_main(self):
        try:
            self.st.db.execute('select 1')
        except Exception:
            return
        self.st.close()

    def put(self, n, state="queued", paths=(), parent=None, **data):
        d = {"issue": n, "title": "T%d" % n, "body": body(paths, parent)}
        d.update(data)
        self.st.put_job(str(n), state, d, None)

    def reader(self, n):
        self.calls.append(n)
        return {"title": "Epic %d" % n, "labels": []}

    def build(self, read=True, st=None):
        return snapshot.build_snapshot(st or self.st, CFG, NOW, None, beat=1, read_epic=self.reader if read else None)

    def job(self, paths):
        self.put(1, paths=paths)
        return self.build()["jobs"][0]

    def test_department_is_the_main_one_and_the_rest_are_listed(self):
        j = self.job(["apps/ui/components/a.tsx", "apps/ui/components/b.tsx", "packages/contracts/src/c.ts"])
        self.assertEqual((j["department"], j["departments"]), ("frontend", ["backend"]))

    def test_every_row_of_the_table(self):
        rows = {"docs/research/2026-11-14-factory-world/SPEC.md": "design", "supabase/migrations/1.sql": "database",
                "apps/engine/src/a.ts": "engine", "apps/ui/app/api/_actions/a.ts": "backend",
                "packages/ui/src/a.tsx": "frontend", "packages/i18n/messages/en/a.json": "frontend",
                "tools/factory/a.py": "tooling", ".github/a.yml": "tooling", "deploy/a.yml": "tooling", "docs/a.md": "docs"}
        for p, dept in rows.items():
            self.assertEqual(self.job([p])["department"], dept, p)

    def test_a_tie_goes_to_table_order_and_an_unknown_path_counts_for_nothing(self):
        j = self.job(["docs/a.md", "tools/factory/a.py"])
        self.assertEqual((j["department"], j["departments"]), ("tooling", ["docs"]))
        j = self.job(["package.json"])
        self.assertNotIn("department", j)
        self.assertNotIn("departments", j)

    def test_epics_are_one_per_distinct_parent_sorted_with_the_kind_and_title(self):
        self.put(1, parent=332)
        self.put(2, parent=312)
        self.put(3, parent=312)
        self.assertEqual(self.build()["epics"], [{"issue": 312, "title": "Epic 312", "kind": "other"},
                                                 {"issue": 332, "title": "Epic 332", "kind": "other"}])
        self.assertEqual(sorted(self.calls), [312, 332])

    def test_a_second_beat_reads_nothing_and_a_new_store_on_the_same_file_reads_nothing(self):
        self.put(1, parent=312)
        first = self.build()["epics"]
        self.assertEqual(self.build()["epics"], first)
        self.st.close()
        st2 = ledger_store.Store(self.path)
        self.addCleanup(st2.close)
        self.assertEqual(self.build(st=st2)["epics"], first)
        self.assertEqual(self.calls, [312])

    def test_kind_table(self):
        for k in snapshot.KINDS:
            self.assertEqual(snapshot._kind("Plain", [{"name": k.replace("_", "-").upper()}]), k)
        for title, k in [("Review and fix of X", "review_fix"), ("Fix the bar", "fix"), ("Upgrade deps", "upgrade"),
                         ("Refactor store", "refactor"), ("Research Y", "research"), ("A new feature", "feature"), ("Plain", "other")]:
            self.assertEqual(snapshot._kind(title, []), k)
        self.assertEqual(snapshot._kind("Fix the bar", [{"name": "research"}]), "research")

    def test_limits(self):
        for n in range(1, 61):
            self.put(n, "merged" if n <= 10 else "queued", parent=100 + n)
        e = self.build()["epics"]
        self.assertEqual(len(e), 50)
        self.assertEqual([x["issue"] for x in e], sorted(x["issue"] for x in e))
        self.assertEqual({x["issue"] for x in e}, set(range(111, 161)))
        self.assertEqual(len(self.calls), 5)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        st = ledger_store.Store(os.path.join(tmp.name, "x.db"))
        self.addCleanup(st.close)
        st.put_job("1", "queued", {"issue": 1, "title": "T", "body": body(parent=7)}, None)
        long = lambda n: {"title": "x" * 400, "labels": []}
        out = snapshot.build_snapshot(st, CFG, NOW, None, read_epic=long)["epics"]
        self.assertEqual(len(out[0]["title"]), 256)

    def test_an_unreadable_epic_gets_its_number_and_is_tried_again(self):
        self.put(1, parent=50)
        calls = []

        def boom(n):
            calls.append(n)
            raise RuntimeError("down")

        for _ in range(2):
            e = snapshot.build_snapshot(self.st, CFG, NOW, None, read_epic=boom)["epics"]
            self.assertEqual(e, [{"issue": 50, "title": "#50", "kind": "other"}])
        self.assertEqual(calls, [50, 50])
        self.assertEqual(self.build(read=False)["epics"], [{"issue": 50, "title": "#50", "kind": "other"}])
        self.assertEqual(self.calls, [])
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        st = ledger_store.Store(os.path.join(tmp.name, "y.db"))
        self.addCleanup(st.close)
        st.put_job("1", "queued", {"issue": 1, "title": "T", "body": body()}, None)
        self.assertEqual(self.build(st=st)["epics"], [])


if __name__ == "__main__":
    unittest.main()
