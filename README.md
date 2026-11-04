# TENET algorithm starter

Sell an algorithm on [TENET](https://runtenet.app): a starter server.

You keep your code on your own server. TENET asks it every few minutes for each buyer's vault and trades what it answers, inside the
buyer's limits. This folder is the smallest server that does that, in Node and in Python (no dependencies).

## Run it

```
cd node            # or: cd python
TENET_SIGNING_SECRET=tas_...  node server.mjs        # python: python server.py
```

`TENET_SIGNING_SECRET` is the secret TENET shows you once, when you list the algorithm. Until you have it, any text works for a local test.

## Test it before you list it

In a second terminal (same secret):

```
cd node
TENET_SIGNING_SECRET=tas_...  node simulate.mjs http://localhost:8787
```

It sends two signed questions (the second with a price that fell) and one with a wrong signature. You should see: no orders, then one
order, then a 401. The same script works against the Python server.

## List it

1. Put the server on any host that gives you a public `https://` address.
2. On the marketplace page (runtenet.app/catalog), open **Sell an algorithm**, choose a vault, write what it does (not what it will earn),
   paste the address, set the price in TT and the number of copies, and sign.
3. Copy the signing secret (shown once) into `TENET_SIGNING_SECRET` on your host and restart.
4. Press **Test my API**. TENET asks your server once and tells you if the answer is the right format.

## What TENET sends and what you answer

See runtenet.app/docs/algorithms. In short: you receive the vault's `limits`, `balances` and `prices`, and answer
`{ "orders": [ { "tokenIn": "USDG", "tokenOut": "AAPL", "amountIn": "10.00", "note": "why" } ] }`, at most 3 orders. An empty list means: wait.

## Rules that save you refusals

- Stay inside `limits`: `maxUsdPerTrade`, `leftTodayUsd`, `nextTradeAt`, and only the symbols in `limits.tokens`. An order outside them is refused and the buyer sees the reason.
- Answer within 10 seconds, with at most 64 KB.
- Check the signature on the raw body and refuse old questions (the starter does).
- Describe the algorithm by what it does, never by what it will earn.

The strategy in `decide` is a toy: it buys $10 of a stock that fell 1.5% under the highest price the server has seen. Replace it with yours.

## Links

- Marketplace: https://runtenet.app/catalog
- Full guide: https://runtenet.app/docs/algorithms
- The contracts: see the `tenet-contracts` repository.

## License

MIT. See `LICENSE`.
