import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D

HERE = os.path.dirname(os.path.abspath(__file__))


def job(*paths):
    return {"issue": 7, "title": "t",
            "body": "**Files**\n" + "".join("- `%s`\n" % p for p in paths) + "\n**Run**\n```\nx\n```\n"}


class WebGuideHint(unittest.TestCase):
    def test_a_ui_build_packet_carries_the_lookup_and_the_rule(self):
        for j in (job("apps/ui/components/factory/ledger.tsx"), job("packages/ui/src/BorderBeam.ts"),
                  job("apps/desktop-app/src/a.css")):
            brief = D.build_brief(j)
            self.assertEqual(brief.count(D.WEB_RULE), 1)
            for part in ('/data/tools/bin/webguide search "<2 to 5 words>"', "/data/tools/bin/webguide get <id>",
                         "Guides read: <id>, <id>", "(no Baseline status)"):
                self.assertIn(part, brief)

    def test_no_hint_outside_web_ui(self):
        for j in (job("tools/factory/a.py"), job("apps/mobile/app/index.tsx"), job("packages/emails/src/welcome.tsx"),
                  job("supabase/templates/magic_link.html"), job("apps/ui/package.json"), job("packages/ui/test_x.py"),
                  {"issue": 7, "title": "t", "body": ""}):
            self.assertNotIn("webguide", D.build_brief(j))
            self.assertNotIn("webguide", D.review_brief(j, 3, "abcdef1234567890"))

    def test_a_ui_review_asks_for_the_fallback_check(self):
        brief = D.review_brief(job("apps/ui/app/factory.css"), 3, "abcdef1234567890")
        self.assertEqual(brief.count("Fallback check: <id>: <result>"), 1)
        self.assertEqual(brief.count(D.WEB_RULE), 1)
        self.assertIn("Guides read:", brief)

    def test_claude_md_ends_with_the_browser_support_rule(self):
        with open(os.path.join(HERE, "..", "..", "CLAUDE.md"), encoding="utf-8") as f:
            text = f.read()
        self.assertEqual(text.count("\n# Browser support\n"), 1)
        tail = text.split("\n# Browser support\n", 1)[1]
        self.assertNotIn("\n# ", tail)
        flat = " ".join(tail.split())
        self.assertIn(" ".join(D.WEB_RULE.split()), flat)
        self.assertIn("/data/tools/bin/webguide get <id>", flat)


if __name__ == "__main__":
    unittest.main()
