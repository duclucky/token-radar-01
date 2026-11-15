# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/duclucky/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/duclucky/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: a dashboard that reads a sealed DefiLlama snapshot of 758 protocols, finds the 198 pre-token protocols that are not wrapped, staked or bridged products of a token that already trades, and ranks them by implied launch value. The model learns each category's market-cap / TVL multiple from the live-token protocols in the same category, then multiplies by seven-day growth, by how long the protocol has run with no token, and by a small multi-chain bonus. Every protocol gets a seven-step farm plan with costs and times, and the dashboard is sortable, filterable, and has a detail view and a model sandbox for each protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
```

Then open out/dashboard/index.html in a browser. No network is needed: the page reads out/data.js, which main.ts writes from the same board.

---

<sub>Entered on [make.fun](https://make.fun/?ref=aa495h0y&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
