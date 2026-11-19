import contextlib
import fcntl
import http.client
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import webguide

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "package/skills/modern-web-guidance/"
LIGHT = (
    "# Light dismiss\n"
    'Run `npx -y modern-web-guidance@latest retrieve "dialog"` for more.\n'
    "If not using a package manager, import from a CDN, e.g. "
    "`https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js`.\n"
    'await import("https://unpkg.com/interestfor@latest");\n'
)
INDEX = [
    {"id": "light-dismiss-a-dialog", "description": "Close a modal dialog by clicking outside it", "category": "ui-behaviors"},
    {"id": "dark-mode-toggle", "description": "Let users override the color scheme", "category": "ui-components"},
    {"id": "dialog", "description": "Build an accessible modal dialog", "category": "ui-components"},
]


def make_tarball():
    files = {
        "package/LICENSE": b"Apache License\n",
        "package/THIRD_PARTY_NOTICES": b"notices\n",
        "package/modern-web.mjs": b"export {}\n",
        BASE + "SKILL.md": b"run npx modern-web-guidance@latest search\n",
        BASE + "watchdog/main.js": b"1\n",
        BASE + "gen/guides.json": json.dumps(INDEX).encode(),
        BASE + "guides/ui-behaviors/light-dismiss-a-dialog.md": LIGHT.encode(),
        BASE + "guides/ui-components/dialog.md": b"# Dialog\n## Fallback strategies\n",
        BASE + "guides/ui-components/dark-mode-toggle.md": b"# Dark mode toggle\n",
        BASE + "guides/../../../../escape.md": b"escape\n",
    }
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, body in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            t.addfile(info, io.BytesIO(body))
    return buf.getvalue()


def tree(d):
    out = []
    for dirpath, _, names in os.walk(d):
        for n in names:
            out.append(os.path.relpath(os.path.join(dirpath, n), d))
    return sorted(out)


class Reply:
    def __init__(self, data, step=1 << 20):
        self.data = data
        self.step = step

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n=-1):
        if n == -1:
            out, self.data = self.data, b""
            return out
        out, self.data = self.data[:self.step], self.data[self.step:]
        return out


def serve(data, asked, step=1 << 20):
    def opener(url, timeout=None):
        asked.append(url)
        return Reply(data, step)
    return opener


def down(url, timeout=None):
    raise OSError("down")


class Cut(Reply):
    def read(self, n=-1):
        raise http.client.IncompleteRead(b"")


def ticks(*values):
    seq = list(values)

    def clock():
        return seq.pop(0) if len(seq) > 1 else seq[0]
    return clock


class Watch:
    def __init__(self):
        self.on = False
        self.opened = []
        self.sockets = []
        sys.addaudithook(self)

    def __call__(self, event, args):
        if not self.on:
            return
        if event.startswith("socket."):
            self.sockets.append(event)
            raise OSError("network is off")
        if event == "open" and isinstance(args[0], str):
            self.opened.append(args[0])


WATCH = Watch()


class WebguideTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name)
        self.d = os.path.join(self.root, "webguide")
        self.data = make_tarball()

    def install(self):
        webguide.install(self.data, self.d, want=webguide.integrity(self.data))

    def test_install_refuses_a_tarball_that_is_not_the_pinned_checksum(self):
        with self.assertRaises(SystemExit):
            webguide.install(self.data, self.d)
        self.assertFalse(os.path.exists(os.path.join(self.d, "guides.json")))

    def test_install_keeps_guides_index_licence_notices_and_states_the_changes(self):
        self.install()
        self.assertEqual(tree(self.d), [
            "CHANGES",
            "LICENSE",
            "THIRD_PARTY_NOTICES",
            "guides.json",
            "guides/ui-behaviors/light-dismiss-a-dialog.md",
            "guides/ui-components/dark-mode-toggle.md",
            "guides/ui-components/dialog.md",
        ])
        self.assertFalse(os.path.exists(os.path.join(self.root, "escape.md")))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.root), "escape.md")))

    def test_no_npx_and_no_latest_in_any_installed_text(self):
        self.install()
        for rel in tree(self.d):
            with open(os.path.join(self.d, rel), encoding="utf-8") as f:
                text = f.read()
            self.assertNotIn("npx", text, rel)
            self.assertNotIn("@latest", text, rel)
        text = webguide.get("light-dismiss-a-dialog", root=self.d)
        self.assertIn("/data/tools/bin/webguide get dialog", text)
        self.assertIn('await import("interestfor")', text)
        self.assertIn(webguide.NO_CDN, text)

    def test_lookup_works_with_the_network_off_and_no_switch_set(self):
        self.install()
        os.environ.pop("DISABLE_TELEMETRY", None)
        WATCH.sockets.clear()
        WATCH.on = True
        try:
            found = webguide.search("light dismiss dialog", root=self.d)
            guide = webguide.get("dialog", root=self.d)
        finally:
            WATCH.on = False
        self.assertEqual([x["id"] for x in found], ["light-dismiss-a-dialog", "dialog"])
        self.assertIn("Fallback strategies", guide)
        self.assertEqual(WATCH.sockets, [])

    def test_a_lookup_reads_the_index_and_the_one_guide_only(self):
        self.install()
        WATCH.opened.clear()
        WATCH.on = True
        try:
            webguide.search("dark mode", root=self.d)
            webguide.get("dark-mode-toggle", root=self.d)
        finally:
            WATCH.on = False
        mine = [os.path.relpath(p, self.d) for p in WATCH.opened if p.startswith(self.d)]
        self.assertEqual(mine, ["guides.json", "guides.json", "guides/ui-components/dark-mode-toggle.md"])

    def test_fetch_asks_only_for_the_pinned_url_and_refuses_other_bytes(self):
        asked = []
        data = self.data

        class Reply:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return data

        def opener(url, timeout=None):
            asked.append(url)
            return Reply()

        with self.assertRaises(SystemExit):
            webguide.fetch(self.d, opener=opener)
        self.assertEqual(asked, [webguide.PIN["url"]])

    def test_the_installed_command_prints_search_results_and_a_guide(self):
        prefix = os.path.join(self.root, "prefix")
        subprocess.run(["sh", os.path.join(HERE, "install.sh"), "--prefix", prefix, "--jev-keyfile", "/x"],
                       check=True, capture_output=True)
        webguide.install(self.data, os.path.join(prefix, "webguide"), want=webguide.integrity(self.data))
        cmd = os.path.join(prefix, "bin", "webguide")
        out = subprocess.run(["sh", cmd, "search", "dark mode toggle"], check=True, capture_output=True, text=True).stdout
        self.assertEqual(json.loads(out)[0], {"id": "dark-mode-toggle", "description": "Let users override the color scheme"})
        out = subprocess.run(["sh", cmd, "get", "dialog"], check=True, capture_output=True, text=True).stdout
        self.assertEqual(out, "# Dialog\n## Fallback strategies\n")

    def leftovers(self):
        return [n for n in os.listdir(self.root) if ".stage." in n or ".old." in n or ".tried" in n]

    def held(self):
        f = open(self.d + ".lock", "a")
        self.addCleanup(f.close)
        fcntl.flock(f, fcntl.LOCK_EX)

    def test_ensure_installs_the_pinned_copy_once_then_leaves_it(self):
        want, asked = webguide.integrity(self.data), []
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        self.assertEqual((code, line), (0, "webguide: installed pinned copy 1.0.0 at %s" % self.d))
        other = os.path.join(self.root, "other")
        webguide.install(self.data, other, want)
        self.assertEqual(tree(self.d), tree(other))
        with open(os.path.join(self.d, "CHANGES"), encoding="utf-8") as f:
            self.assertEqual(f.read(), webguide.notice(want))
        self.assertEqual(self.leftovers(), [])
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        self.assertEqual(code, 0)
        self.assertIn("in place", line)
        self.assertEqual(asked, [webguide.PIN["url"]])

    def test_ensure_with_a_trailing_slash_installs_beside_the_copy(self):
        want, asked = webguide.integrity(self.data), []
        code, _ = webguide.ensure(self.d + "/", opener=serve(self.data, asked), want=want)
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(self.d + ".lock"))
        self.assertFalse(os.path.exists(self.d + "/.lock"))
        self.assertIsNone(webguide.missing(self.d, want))
        for bad in ("/", ""):
            calls = []
            code, _ = webguide.ensure(bad, opener=serve(self.data, calls), want=want)
            self.assertEqual(code, 2)
            self.assertEqual(calls, [])

    def test_ensure_after_a_failed_fetch_waits_an_hour_then_tries_again(self):
        want, asked = webguide.integrity(self.data), []
        code, line = webguide.ensure(self.d, opener=down, want=want, now=lambda: 1000)
        self.assertEqual(code, 1)
        self.assertIn("install failed (down); next try after 1970-01-01T01:16:40Z", line)
        self.assertFalse(os.path.exists(self.d))
        self.assertEqual([n for n in os.listdir(self.root) if ".stage." in n], [])
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want, now=lambda: 1060)
        self.assertEqual(code, 1)
        self.assertIn("the last try at 1970-01-01T00:16:40Z did not install the copy", line)
        self.assertEqual(asked, [])
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want, now=lambda: 4601)
        self.assertEqual(code, 0)
        self.assertIn("installed", line)
        self.assertEqual(self.leftovers(), [])

    def test_ensure_refuses_bytes_that_are_not_pinned(self):
        code, line = webguide.ensure(self.d, opener=serve(self.data, []))
        self.assertEqual(code, 1)
        self.assertIn("does not match the pinned checksum", line)
        self.assertFalse(os.path.exists(self.d))

    def test_ensure_repairs_a_copy_with_a_guide_missing(self):
        want, asked = webguide.integrity(self.data), []
        webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        os.remove(os.path.join(self.d, "guides", "ui-components", "dialog.md"))
        self.assertEqual(webguide.missing(self.d, want), "guides/ui-components/dialog.md")
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        self.assertEqual(len(asked), 2)
        self.assertEqual(code, 0)
        self.assertIn("installed", line)
        self.assertTrue(os.path.isfile(os.path.join(self.d, "guides", "ui-components", "dialog.md")))

    def test_ensure_replaces_a_copy_written_under_other_rules(self):
        want, asked = webguide.integrity(self.data), []
        webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        with open(os.path.join(self.d, "CHANGES"), "w") as f:
            f.write("old")
        webguide.ensure(self.d, opener=serve(self.data, asked), want=want)
        self.assertEqual(len(asked), 2)
        with open(os.path.join(self.d, "CHANGES"), encoding="utf-8") as f:
            self.assertEqual(f.read(), webguide.notice(want))

    def test_ensure_while_another_install_runs_does_nothing(self):
        asked = []
        self.held()
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=webguide.integrity(self.data))
        self.assertEqual(code, 0)
        self.assertIn("another install", line)
        self.assertEqual(asked, [])

    def test_a_failed_swap_puts_the_old_copy_back(self):
        want = webguide.integrity(self.data)
        webguide.ensure(self.d, opener=serve(self.data, []), want=want)
        with open(os.path.join(self.d, "CHANGES"), "w") as f:
            f.write("old")

        def rename(src, dst):
            if ".stage." in src:
                raise OSError("swap")
            os.rename(src, dst)
        code, line = webguide.ensure(self.d, opener=serve(self.data, []), want=want, rename=rename)
        self.assertEqual(code, 1)
        self.assertIn("install failed (swap)", line)
        with open(os.path.join(self.d, "CHANGES"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "old")
        self.assertEqual([n for n in os.listdir(self.root) if ".stage." in n or ".old." in n], [])

    def test_a_run_killed_mid_download_is_cleaned_up_after_the_wait(self):
        want, asked = webguide.integrity(self.data), []
        with open(self.d + ".tried", "w") as f:
            f.write("1000")
        os.makedirs(self.d + ".stage.999/guides")
        code, line = webguide.ensure(self.d, opener=serve(self.data, asked), want=want, now=lambda: 1060)
        self.assertEqual(code, 1)
        self.assertIn("did not install the copy", line)
        self.assertEqual(asked, [])
        code, _ = webguide.ensure(self.d, opener=serve(self.data, asked), want=want, now=lambda: 4601)
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(self.d + ".stage.999"))

    def test_a_run_killed_mid_swap_gets_its_copy_back(self):
        want = webguide.integrity(self.data)
        webguide.install(self.data, self.d + ".old.999", want)
        code, line = webguide.ensure(self.d, opener=down, want=want)
        self.assertEqual(code, 0)
        self.assertIn("in place", line)
        self.assertIsNone(webguide.missing(self.d, want))

    def test_a_download_past_the_budget_stops_itself(self):
        want = webguide.integrity(self.data)
        opener = serve(self.data, [], step=len(self.data) // 3 + 1)
        code, line = webguide.ensure(self.d, opener=opener, want=want, clock=ticks(0, 45))
        self.assertEqual(code, 1)
        self.assertIn("the download passed 40 s", line)
        self.assertFalse(os.path.exists(self.d))
        self.assertEqual([n for n in os.listdir(self.root) if ".stage." in n], [])

    def test_a_body_cut_mid_download_is_one_failed_line(self):
        want = webguide.integrity(self.data)
        code, line = webguide.ensure(self.d, opener=lambda url, timeout=None: Cut(self.data), want=want)
        self.assertEqual(code, 1)
        self.assertIn("webguide: install failed (", line)
        self.assertFalse(os.path.exists(self.d))
        self.assertEqual([n for n in os.listdir(self.root) if ".stage." in n], [])

    def test_the_ensure_and_fetch_commands_print_one_line(self):
        self.held()
        for argv in (["--dir", self.d + "/", "ensure"], ["--dir", self.d, "fetch"]):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = webguide.main(argv)
            self.assertEqual(code, 0)
            self.assertEqual(out.getvalue(), "webguide: another install of the guide copy is running; nothing done\n")

    def test_a_lookup_without_a_copy_says_so(self):
        prefix = os.path.join(self.root, "prefix")
        subprocess.run(["sh", os.path.join(HERE, "install.sh"), "--prefix", prefix, "--jev-keyfile", "/x"],
                       check=True, capture_output=True)
        cmd = os.path.join(prefix, "bin", "webguide")
        for args in (["search", "dialog"], ["get", "dialog"]):
            r = subprocess.run(["sh", cmd] + args, capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            for part in ("no usable guide copy at", "(guides.json is missing)", "webguide ensure"):
                self.assertIn(part, r.stderr)
            self.assertNotIn("Traceback", r.stderr)
        copy = os.path.join(prefix, "webguide")
        webguide.install(self.data, copy, want=webguide.integrity(self.data))
        os.remove(os.path.join(copy, "guides", "ui-components", "dialog.md"))
        r = subprocess.run(["sh", cmd, "get", "dialog"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("(guides/ui-components/dialog.md is missing)", r.stderr)
        with open(os.path.join(copy, "guides.json"), "w") as f:
            f.write("{")
        r = subprocess.run(["sh", cmd, "search", "dialog"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("(guides.json is unreadable)", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
