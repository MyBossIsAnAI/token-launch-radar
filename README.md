# Token Launch Radar

[![make.fun - token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/MyBossIsAnAI/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/MyBossIsAnAI/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every protocol that still records no token, ranked by what its launch would be
worth — priced off the multiples of tokens that already trade.

## The model (radar-2)

The board covers the snapshot's whole watchlist (the 40 protocols at or above
$50M TVL that record no token) plus the 160 rankable pre-token protocols below
the floor with the most TVL: 200 rows.

For each category, the peers are the protocols in the same snapshot that
already trade (they carry a market cap). A peer's ratio is mcap / TVL, kept
only when 0 < ratio <= 50, and CEX-category protocols are never peers. A
category's base multiple is the MEDIAN of its peers' ratios when it has at
least 4 peers; otherwise the median of its category family (families grouped
by keyword: Lending & credit, Trading & derivatives, Yield & vaults, Staking
& restaking, Chains & bridging, Money & payments); otherwise the whole-market
median.

```
growth   = 1 + clamp(change_7d, -60, +120) / 100 * 0.5
maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4   (unknown age: 365 days)
implied  = TVL * base_multiple * growth * maturity
```

Each row carries a six-step farm plan, built from the protocol's own category,
chains, TVL and age: a category-specific core action, capital tiered by TVL
($50–$250), a weekly cadence step, a hold window scaled by age, official-
links-only safety language, and a record-keeping step.

## Honest caveats

An implied value is a comparable-based estimate, not a prediction: it says
what a token might be worth if the protocol issued one at its peers'
multiple, not that it will. Most protocols on this board may never issue a
token. A protocol records no token in this snapshot; that is not proof it has
none. Farm plans are generic steps, not financial advice.

## Run it

```
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot dir>
```

Node >= 22.18, standard library only. `main.ts` reads the sealed snapshot,
writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`
into the output directory, and writes `dossier.json` last with the vendored
make.fun library (`vendor/makefun-board.ts`). Open `dashboard/index.html`
from the output directory: board, per-protocol detail views, live-token
comparables, methodology with the multiples table, and a model sandbox that
re-ranks the board with your own growth weight and multiple scale.

## Files

- `main.ts` — entry point: read snapshot, score, write outputs, build dossier
- `lib/model.ts` — the radar-2 model, farm plans, board gate check
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, verbatim
- `dashboard/` — static single-page app (index.html, app.css, app.js), no network
- `screenshots/` — board, detail and filtered views of the dashboard
