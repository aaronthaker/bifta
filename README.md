# Touchline

A dependency-free 2026 FIFA World Cup research interface. It combines the upcoming
World Cup schedule, matched Pinnacle prices, and ESPN's last-five international
match data in a deliberately minimal fixture-first UI.

## Run

```sh
python3 -m http.server 5173
```

Open `http://localhost:5173`.

## Shared Pinnacle odds history

The GitHub Pages app can use a Cloudflare Worker for shared Pinnacle odds
history across every visitor and device. The committed `config.js` expects this
Worker for production so the Pinnacle key is not exposed in the browser.

### 1. Create the Cloudflare Worker

```sh
cd worker
cp wrangler.toml.example wrangler.toml
npx wrangler login
npx wrangler kv namespace create PINNACLE_ODDS_KV
```

Copy the `id` printed by the KV command into `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "PINNACLE_ODDS_KV"
id = "PASTE_THE_PRINTED_ID_HERE"
```

Set the Pinnacle key as a Worker secret:

```sh
npx wrangler secret put PINNACLE_API_KEY
```

Paste the Pinnacle API key when Wrangler asks for it, then deploy:

```sh
npx wrangler deploy
```

Wrangler prints a Worker URL like:

```text
https://touchline-pinnacle.YOUR_SUBDOMAIN.workers.dev
```

### 2. Point the app at the Worker

Edit `config.js`:

```js
window.TOUCHLINE_CONFIG = {
  pinnacleWorkerUrl: "https://touchline-pinnacle.YOUR_SUBDOMAIN.workers.dev",
};
```

Commit and push the app to GitHub Pages. Once deployed, every visitor will read
the same shared movement log from Cloudflare KV.

## Match research

Opening a fixture loads:

- Pinnacle's available full-match, handicap, and team-total lines.
- Each team's five most recent internationals from the ESPN match summary.
- The complete ESPN team stat sheet for every available source match.
- Every player in each team's current World Cup squad, with collapsible last-five
  appearance and stat tables.
- Recorded player lines including goals, shots, shots on target, fouls, cards,
  offsides, and saves.
- A short prop list filtered for agreement between the market and recent form.
- Player watchlist trends with a conservative sample-only price gate.

The app labels incomplete coverage and does not present trend scores as guaranteed
profit or calibrated win probabilities. Prices, lineups, expected minutes, opponent
strength, and staking discipline still need to be checked before betting.
