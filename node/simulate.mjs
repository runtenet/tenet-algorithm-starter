// Ask your own server the way TENET will, before you list it. Node 18+, no dependencies.
//
//   TENET_SIGNING_SECRET=tas_...  node simulate.mjs http://localhost:8787
//
// It builds a question like the one TENET sends (a vault with limits, balances and prices), signs it with your secret, posts it twice
// (the second time one price has fallen) and prints your server's answers. It also checks that a wrong signature is refused.
import { createHmac } from "node:crypto";

const SECRET = process.env.TENET_SIGNING_SECRET;
const URL_ = process.argv[2] ?? "http://localhost:8787";
if (!SECRET) throw new Error("Set TENET_SIGNING_SECRET");

const question = (aaplPrice) => ({
  version: 1,
  vault: "0x0000000000000000000000000000000000000001",
  time: Math.floor(Date.now() / 1000),
  dryRun: false,
  limits: {
    ready: true,
    maxUsdPerTrade: 50,
    maxUsdPerDay: 100,
    spentTodayUsd: 0,
    leftTodayUsd: 100,
    minIntervalSeconds: 60,
    nextTradeAt: 0,
    maxSlippagePercent: 1.5,
    tokens: [{ symbol: "USDG" }, { symbol: "AAPL" }, { symbol: "NVDA" }],
  },
  balances: [{ symbol: "USDG", amount: "400" }],
  prices: [
    { symbol: "AAPL", usd: aaplPrice },
    { symbol: "NVDA", usd: 200 },
  ],
});

async function ask(body, secret = SECRET) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "x-tenet-timestamp": String(timestamp), "x-tenet-signature": signature }, body: raw });
  return { status: res.status, text: await res.text() };
}

const first = await ask(question(230));
console.log("question 1 (AAPL at 230):", first.status, first.text);
const second = await ask(question(222)); // a 3.5% fall from 230
console.log("question 2 (AAPL at 222):", second.status, second.text);
const wrong = await ask(question(222), "tas_not_the_secret");
console.log("wrong signature:", wrong.status, wrong.text, wrong.status === 401 ? "(good: refused)" : "(BAD: it should be refused)");
