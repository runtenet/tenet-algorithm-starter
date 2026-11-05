"""A starter server for selling an algorithm on TENET. Python 3.9+, standard library only.

    TENET_SIGNING_SECRET=tas_...  python server.py

What it does: TENET sends this server a signed question every few minutes for each buyer's vault. The server checks the signature,
looks at the vault's limits, balances and prices, and answers with the orders it wants: {"orders": [...]} (an empty list means: wait).
The strategy below is a tiny example (buy a small amount of a stock that fell under its own recent high). Replace `decide` with yours.
"""
import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("TENET_SIGNING_SECRET")  # shown once, when you list the algorithm
PORT = int(os.environ.get("PORT", "8787"))
if not SECRET:
    raise SystemExit("Set TENET_SIGNING_SECRET (the signing secret TENET showed you when you listed the algorithm)")


def from_tenet(raw_body: str, timestamp: str, signature: str) -> bool:
    """Is this question really from TENET, and fresh? The signature is sha256= + HMAC-SHA256(secret, f"{timestamp}.{raw_body}") in hex."""
    try:
        age = abs(time.time() - float(timestamp))
    except (TypeError, ValueError):
        return False
    if age > 300:  # refuse a question older than 5 minutes
        return False
    want = "sha256=" + hmac.new(SECRET.encode(), f"{timestamp}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, signature or "")


seen = {}  # signature -> when it was first seen: a question that was already answered is not answered again


def first_time(signature: str) -> bool:
    """True the first time a valid signature shows up, False for a replay inside the 5-minute window."""
    now = time.time()
    for k in [k for k, t in seen.items() if now - t > 330]:
        del seen[k]
    if signature in seen:
        return False
    seen[signature] = now
    return True


# ---------------------------------------------------------------- your strategy

DIP_PCT = 1.5  # buy a stock that is this many percent under the highest price this server has seen
BUY_USD = 10  # how much to buy each time, in dollars
high = {}  # symbol -> the highest price seen so far (kept in memory: it resets when the server restarts)


def decide(q: dict) -> list:
    """The question TENET sends (see the docs): limits, balances, prices. Returns a list of orders, or [] to wait."""
    limits = q.get("limits") or {}
    usdg = next((float(b["amount"]) for b in q.get("balances", []) if b["symbol"] == "USDG"), 0.0)
    allowed = {t["symbol"] for t in limits.get("tokens", [])}

    # always remember the highs, even when we cannot trade right now
    for p in q.get("prices", []):
        high[p["symbol"]] = max(high.get(p["symbol"], 0.0), p["usd"])

    # stay inside the buyer's limits: an order outside them is only refused, and the buyer sees it
    if not limits.get("ready"):
        return []
    if limits.get("nextTradeAt") and time.time() < limits["nextTradeAt"]:  # one trade every minIntervalSeconds
        return []
    amount = min(BUY_USD, limits.get("maxUsdPerTrade", 0), limits.get("leftTodayUsd", 0), usdg)
    if amount < 1:
        return []

    for p in q.get("prices", []):
        if p["symbol"] in ("USDG", "WETH") or p["symbol"] not in allowed:
            continue
        top = high[p["symbol"]]
        under = (top - p["usd"]) / top * 100
        if under >= DIP_PCT:
            return [{"tokenIn": "USDG", "tokenOut": p["symbol"], "amountIn": f"{amount:.2f}", "note": f"{p['symbol']} is {under:.1f}% under its high"}]
    return []


# ---------------------------------------------------------------- the server


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # a health check for your host
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        try:
            size = int(self.headers.get("content-length") or 0)
        except ValueError:
            size = -1
        if size < 0:
            self.send_response(400)
            self.end_headers()
            return
        if size > 100_000:  # a question is small: refuse a huge body
            self.send_response(413)
            self.end_headers()
            return
        raw = self.rfile.read(size).decode("utf-8")
        if not from_tenet(raw, self.headers.get("x-tenet-timestamp"), self.headers.get("x-tenet-signature")):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"not from TENET")
            return
        if not first_time(self.headers.get("x-tenet-signature")):
            self.send_response(409)
            self.end_headers()
            self.wfile.write(b"already answered")
            return
        try:
            question = json.loads(raw)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return
        try:
            orders = decide(question)[:3]  # TENET takes at most 3 orders per question
        except Exception:  # a signed but odd question must not crash the server
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"could not read the question")
            return
        body = json.dumps({"orders": orders}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the logs quiet
        pass


if __name__ == "__main__":
    print(f"algorithm server on :{PORT}")
    HTTPServer(("", PORT), Handler).serve_forever()
