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


if __name__ == "__main__":
    unittest.main()
