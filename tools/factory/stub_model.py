import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ("stub-fast", "stub-hold")
DEFAULT_HOLD_SECONDS = 600.0
USAGE = {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
REPLY_WORDS = ("stub", "reply")


def hold_seconds():
    try:
        return max(0.0, float(os.environ.get("STUB_HOLD_SECONDS", DEFAULT_HOLD_SECONDS)))
    except ValueError:
        return DEFAULT_HOLD_SECONDS


def chunk(model, delta, finish=None, usage=None):
    body = {"id": "stub-1", "object": "chat.completion.chunk", "created": 1, "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    if usage is not None:
        body["usage"] = usage
    return "data: " + json.dumps(body) + "\n\n"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    counts = {}
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if path.endswith("/models"):
            self.send_json(200, {"object": "list", "data": [{"id": m, "object": "model", "created": 1, "owned_by": "stub"} for m in MODELS]})
        elif path.endswith("/stats"):
            with self.lock:
                self.send_json(200, dict(self.counts))
        elif path == "/health":
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if not self.path.split("?")[0].rstrip("/").endswith("/chat/completions"):
            return self.send_json(404, {"error": {"message": "not found"}})
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": {"message": "invalid json"}})
        model = request.get("model")
        if model not in MODELS:
            return self.send_json(404, {"error": {"message": "unknown model " + str(model)}})
        run = self.headers.get("x-run-id") or self.headers.get("x-rerun-agent") or "unknown"
        with self.lock:
            self.counts[run] = self.counts.get(run, 0) + 1
        if not request.get("stream"):
            return self.send_json(200, {"id": "stub-1", "object": "chat.completion", "created": 1, "model": model,
                                        "choices": [{"index": 0, "message": {"role": "assistant", "content": " ".join(REPLY_WORDS)}, "finish_reason": "stop"}],
                                        "usage": USAGE})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.emit(chunk(model, {"role": "assistant", "content": REPLY_WORDS[0] + " "}))
            if model == "stub-hold":
                time.sleep(hold_seconds())
            self.emit(chunk(model, {"content": REPLY_WORDS[1]}))
            self.emit(chunk(model, {}, finish="stop", usage=USAGE))
            self.emit("data: [DONE]\n\n")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def emit(self, text):
        self.wfile.write(text.encode())
        self.wfile.flush()


def serve(port):
    return ThreadingHTTPServer(("0.0.0.0", port), Handler)


if __name__ == "__main__":
    server = serve(int(sys.argv[1]) if len(sys.argv) > 1 else 8080)
    print("stub-model listening on", server.server_address[1], flush=True)
    server.serve_forever()
