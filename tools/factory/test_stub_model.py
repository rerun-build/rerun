import json, os, sys, threading, time, unittest, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stub_model as S


class StubTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["STUB_HOLD_SECONDS"] = "0.4"
        S.Handler.counts.clear()
        cls.server = S.serve(0)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, model, stream, run="r1"):
        body = json.dumps({"model": model, "stream": stream, "messages": [{"role": "user", "content": "hi"}]}).encode()
        req = urllib.request.Request(self.base + "/v1/chat/completions", body, {"Content-Type": "application/json", "x-run-id": run})
        return urllib.request.urlopen(req, timeout=10)

    def events(self, response):
        lines = [l.decode().strip() for l in response.read().splitlines() if l.startswith(b"data: ")]
        return [l[6:] for l in lines]

    def test_lists_both_models(self):
        with urllib.request.urlopen(self.base + "/v1/models", timeout=10) as r:
            self.assertEqual([m["id"] for m in json.load(r)["data"]], ["stub-fast", "stub-hold"])

    def test_fast_answers_at_once_with_usage_and_done(self):
        start = time.time()
        events = self.events(self.post("stub-fast", True))
        self.assertLess(time.time() - start, 0.3)
        self.assertEqual(events[-1], "[DONE]")
        self.assertEqual(json.loads(events[-2])["usage"]["total_tokens"], 2)

    def test_hold_streams_first_chunk_then_waits_for_the_cap(self):
        start = time.time()
        response = self.post("stub-hold", True)
        first = response.readline()
        self.assertIn(b"assistant", first)
        self.assertLess(time.time() - start, 0.3)
        rest = response.read()
        self.assertGreaterEqual(time.time() - start, 0.4)
        self.assertIn(b"[DONE]", rest)

    def test_non_streaming_reply(self):
        with self.post("stub-fast", False) as r:
            body = json.load(r)
        self.assertEqual(body["choices"][0]["finish_reason"], "stop")

    def test_unknown_model_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("nope", False)
        self.assertEqual(caught.exception.code, 404)

    def test_counts_requests_per_run(self):
        self.post("stub-fast", False, run="count-a").read()
        self.post("stub-fast", False, run="count-a").read()
        with urllib.request.urlopen(self.base + "/stats", timeout=10) as r:
            self.assertEqual(json.load(r)["count-a"], 2)


if __name__ == "__main__":
    unittest.main()
