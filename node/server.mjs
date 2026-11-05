// A starter server for selling an algorithm on TENET. Node 18+, no dependencies.
//
//   TENET_SIGNING_SECRET=tas_...  node server.mjs
//
// What it does: TENET sends this server a signed question every few minutes for each buyer's vault. The server checks the signature,
// looks at the vault's limits, balances and prices, and answers with the orders it wants: { "orders": [ ... ] } (an empty list means: wait).
// The strategy below is a tiny example (buy a small amount of a stock that fell under its own recent high). Replace `decide` with yours.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.TENET_SIGNING_SECRET; // shown once, when you list the algorithm
const PORT = Number(process.env.PORT ?? 8787);
if (!SECRET) throw new Error("Set TENET_SIGNING_SECRET (the signing secret TENET showed you when you listed the algorithm)");

/** Is this question really from TENET, and fresh? The signature is sha256= + HMAC-SHA256(secret, `${timestamp}.${rawBody}`) in hex. */
function fromTenet(rawBody, timestamp, signature) {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false; // refuse a question older than 5 minutes
  const want = Buffer.from("sha256=" + createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex"));
  const got = Buffer.from(String(signature ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

const seen = new Map(); // signature -> when it was first seen: a question that was already answered is not answered again
/** True the first time a valid signature shows up, false for a replay inside the 5-minute window. */
function firstTime(signature) {
  const now = Date.now();
  for (const [s, t] of seen) if (now - t > 330_000) seen.delete(s);
  if (seen.has(signature)) return false;
  seen.set(signature, now);
  return true;
}

// ---------------------------------------------------------------- your strategy

const DIP_PCT = 1.5; // buy a stock that is this many percent under the highest price this server has seen
const BUY_USD = 10; // how much to buy each time, in dollars
const high = new Map(); // symbol -> the highest price seen so far (kept in memory: it resets when the server restarts)

/** The question TENET sends (see the docs): limits, balances, prices. Returns a list of orders, or [] to wait. */
function decide(q) {
  const limits = q.limits ?? {};
  const usdg = Number((q.balances ?? []).find((b) => b.symbol === "USDG")?.amount ?? 0);
  const allowed = new Set((limits.tokens ?? []).map((t) => t.symbol));

  // always remember the highs, even when we cannot trade right now
  for (const p of q.prices ?? []) high.set(p.symbol, Math.max(high.get(p.symbol) ?? 0, p.usd));

  // stay inside the buyer's limits: an order outside them is only refused, and the buyer sees it
  if (!limits.ready) return [];
  if (limits.nextTradeAt && Date.now() / 1000 < limits.nextTradeAt) return []; // the vault allows one trade every minIntervalSeconds
  const amount = Math.min(BUY_USD, limits.maxUsdPerTrade ?? 0, limits.leftTodayUsd ?? 0, usdg);
  if (!(amount >= 1)) return [];

  for (const p of q.prices ?? []) {
    if (p.symbol === "USDG" || p.symbol === "WETH" || !allowed.has(p.symbol)) continue;
    const top = high.get(p.symbol);
    const under = ((top - p.usd) / top) * 100;
    if (under >= DIP_PCT) {
      return [{ tokenIn: "USDG", tokenOut: p.symbol, amountIn: amount.toFixed(2), note: `${p.symbol} is ${under.toFixed(1)}% under its high` }];
    }
  }
  return [];
}

// ---------------------------------------------------------------- the server

createServer((req, res) => {
  if (req.method === "GET") return res.end("ok"); // a health check for your host
  if (req.method !== "POST") return void res.writeHead(405).end();
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 100_000) req.destroy(); // a question is small: refuse a huge body
  });
  req.on("end", () => {
    if (!fromTenet(raw, req.headers["x-tenet-timestamp"], req.headers["x-tenet-signature"])) {
      return void res.writeHead(401).end("not from TENET");
    }
    if (!firstTime(req.headers["x-tenet-signature"])) return void res.writeHead(409).end("already answered");
    let question;
    try {
      question = JSON.parse(raw);
    } catch {
      return void res.writeHead(400).end("bad json");
    }
    let orders;
    try {
      orders = decide(question).slice(0, 3);
    } catch {
      return void res.writeHead(400).end("could not read the question"); // a signed but odd question must not crash the server
    } // TENET takes at most 3 orders per question
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ orders }));
  });
}).listen(PORT, () => console.log(`algorithm server on :${PORT}`));
