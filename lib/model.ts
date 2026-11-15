// Token Radar model, version radar-2.
//
// One sealed snapshot in, one ranked board out. The board ranks every
// pre-token protocol the snapshot can honestly rank: the watchlist's 40
// plus every other pre-token protocol below the floor that is not a
// wrapped, staked or bridged product of a token that already trades.
// That exclusion is the house watchlist rule applied to the whole board,
// not just to the watchlist, so WBTC, Binance staked ETH, USDT0 and the
// other wrapped products never appear as if they could launch a token.
//
// Implied value is computed from the snapshot alone, in five steps:
//
//   category multiple = median market-cap / TVL of the live-token
//     protocols in the same category (at least 4 of them, else the
//     overall live median), clamped to [0.08, 0.65]. The multiples are
//     computed from the snapshot at run time, never written by hand.
//   base       = tvl_usd x category multiple
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.65 + min(age_days, 1095) / 1095 x 0.35
//     (age unknown: 365 days). A protocol that has run longer with no
//     token has more pent-up launch value, up to a 3-year cap.
//   chainMult  = 1 + 0.02 x min(chains - 1, 5), at most 1.10
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// No protocol name is ever special-cased. The same function scores
// every row, and the dashboard recomputes every row from the same
// figures, so the page and board.json always agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  cat_mult_min: number;
  cat_mult_max: number;
  cat_mult_min_live: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 5,
  cat_mult_min: 0.08,
  cat_mult_max: 0.65,
  cat_mult_min_live: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One live category's multiple, computed from the snapshot's live set. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_n: number;
  raw_median: number | null;
  fallback: boolean;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; farm_steps travel with it so the page shows exactly what board.json carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_per_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: CategoryMultiple[];
  overall_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-unsorted list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house watchlist's exclusion categories: wrapped, staked and bridged products, and exchanges. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole wrapped / staked / staking word anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a pre-token protocol is not rankable, or null when it is. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The live-token protocols the multiples are learned from: they trade, are not exchanges, and are not wrapped products. */
export function livePool(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && exclusionReason(p) === null,
  );
}

/**
 * The category multiples, learned from the snapshot's live set at run time.
 * A category with at least `cat_mult_min_live` live protocols uses its own
 * median market-cap / TVL; every other category falls back to the overall
 * live median. Both are clamped to [cat_mult_min, cat_mult_max] so one
 * thin category (two protocols, a 9.5x median) can never dominate a board.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { multiples: Map<string, CategoryMultiple>; overall: number } {
  const live = livePool(snapshot);
  const overallRaw = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  // Rounded to 4 decimals here, so the dashboard's recompute (which reads
  // the rounded multiple from data.js) returns the board's number exactly.
  const overall = round4(Math.min(model.cat_mult_max, Math.max(model.cat_mult_min, overallRaw)));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(p.mcap_usd! / p.tvl_usd);
  }
  const multiples = new Map<string, CategoryMultiple>();
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  for (const category of categories) {
    const ratios = byCategory.get(category) ?? [];
    if (ratios.length >= model.cat_mult_min_live) {
      const raw = median(ratios);
      multiples.set(category, {
        category,
        multiple: round4(Math.min(model.cat_mult_max, Math.max(model.cat_mult_min, raw))),
        live_n: ratios.length,
        raw_median: Math.round(raw * 10000) / 10000,
        fallback: false,
      });
    } else {
      multiples.set(category, {
        category,
        multiple: overall,
        live_n: ratios.length,
        raw_median: ratios.length > 0 ? Math.round(median(ratios) * 10000) / 10000 : null,
        fallback: true,
      });
    }
  }
  return { multiples, overall };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  categoryMultiple: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const base = protocol.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples } = categoryMultiples(snapshot, model);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const mult = multiples.get(p.category ?? 'Other')?.multiple ?? 0.25;
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, mult, model);
    return { p, mult, implied, growthPct, growthMult, maturityMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.mult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the borrow position open, never letting it sit empty.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the range the app suggests, and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares for the full hold.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares, so the vault's allocation counts as your activity.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet for the full hold.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade, then close it the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} on ${chain} and place one market position, then leave the winnings staked in the app.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold.`;
  if (c.includes('restak')) return `Restake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${name}'s chain and use it in one of the chain's own apps, in the same wallet.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} in two separate transactions a week apart, from the farming wallet.`;
  if (c.includes('governance')) return `Lock $${capital} of voting power through ${name} on ${chain} and vote on one live proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full hold.`;
}

/** The category's weekly qualifying action, different from the main deposit. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Each week, borrow a small amount against your ${name} deposit on ${chain} and repay it, so the position shows fresh activity.`;
  if (c.includes('dex')) return `Each week, swap a small amount through ${name} on ${chain} and add the proceeds back to your liquidity position.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Each week, claim any rewards ${name} shows on ${chain} and redeposit them into the same vault.`;
  if (c.includes('rwa')) return `Each week, check ${name}'s yield accrual on ${chain} and mint a small top-up of the same asset.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Each week, open and close one small trade on ${name} on ${chain} with the same margin wallet.`;
  if (c.includes('prediction')) return `Each week, place one small new market position on ${name} on ${chain} and settle the last one.`;
  if (c.includes('governance')) return `Each week, vote on any new ${name} proposal on ${chain} from the same wallet.`;
  return `Each week, make one small deposit, swap or vote on ${name} on ${chain} from the same wallet.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the $${capital} you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Each month, open ${p.name}'s own points or rewards page from its official site and note your points balance in the farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: `Set a stop before you start: if ${p.name}'s TVL falls 30% in one week or deposits pause, unwind the position and stop farming it.`,
      cost: 'nothing to set, about $4 of gas to unwind',
      time: '10 minutes a week to check',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and plan the exit now: withdraw in two steps over two days.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return livePool(snapshot)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_per_tvl: p.tvl_usd > 0 && p.mcap_usd !== null ? Math.round((p.mcap_usd / p.tvl_usd) * 10000) / 10000 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried along so the page shows exactly what board.json holds. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { multiples, overall } = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: [...multiples.values()].sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1)),
    overall_multiple: round4(overall),
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
