# Touchline

A dependency-free 2026 FIFA World Cup research interface. It combines the upcoming
World Cup schedule, matched Pinnacle prices, and ESPN's last-five international
match data in a deliberately minimal fixture-first UI.

## Run

```sh
python3 -m http.server 5173
```

Open `http://localhost:5173`.

## Match research

Opening a fixture loads:

- Pinnacle's available full-match, handicap, and team-total lines.
- Each team's five most recent internationals from the ESPN match summary.
- The complete ESPN team stat sheet for every available source match.
- Recorded player lines including goals, shots, shots on target, fouls, cards,
  offsides, and saves.
- A short prop list filtered for agreement between the market and recent form.
- Player watchlist trends with a conservative sample-only price gate.

The app labels incomplete coverage and does not present trend scores as guaranteed
profit or calibrated win probabilities. Prices, lineups, expected minutes, opponent
strength, and staking discipline still need to be checked before betting.
