// radar-2: rank pre-token protocols by an implied launch value built from
// peer multiples, then give every row a concrete six-step farm plan.
//
// The only inputs are the sealed snapshot's own figures. For each category,
// the peers are the protocols in the same snapshot that already trade (they
// carry a market cap); a peer's ratio is mcap / TVL, kept only when
// 0 < ratio <= 50, and CEX-category protocols are never peers. A category's
// base multiple is the MEDIAN of its peers' ratios when it has at least four
// peers; otherwise the median of its category FAMILY (families grouped by
// keyword below); otherwise the whole-market median of all peer ratios.
//
//   growth   = 1 + clamp(change_7d, -60, +120) / 100 * 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4   (unknown age: 365 days)
//   implied  = TVL * base_multiple * growth * maturity
//
// The board is the snapshot's whole watchlist (40 protocols at or above the
// $50M floor that record no token) plus the 160 rankable pre-token protocols
// below the floor with the most TVL: 200 rows. No protocol name is ever
// special-cased; the same functions score every row.

/** One protocol entry, exactly the ten fields the sealed input carries. */
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

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the board carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's comparables table carries. */
export const LIVE_ROWS = 24;

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_ratio_cap: 50,
  min_peers: 4,
};

/** Where a row's base multiple came from. */
export type MultipleSource = 'category' | 'family' | 'market';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_per_tvl: number;
  base_multiple: number;
  peer_count: number;
  multiple_source: MultipleSource;
  watchlist: boolean;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** One live-token protocol, for the dashboard's comparables table. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** One line of the per-category multiples table the dashboard shows. */
export interface MultipleRow {
  category: string;
  peers: number;
  multiple: number;
  source: MultipleSource;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_scanned: number;
  combined_implied_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
  multiples: MultipleRow[];
  caveats: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The median of a non-empty list, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A category's family, by keyword; null when no family claims it. */
export function familyOf(category: string | null): string | null {
  if (category === null) return null;
  const c = category.toLowerCase();
  if (['lend', 'cdp', 'collateral', 'credit', 'borrow', 'uncollateralized'].some((k) => c.includes(k))) return 'Lending & credit';
  if (['dex', 'deriv', 'perpetual', 'option', 'synthetic', 'predict', 'basis', 'otc'].some((k) => c.includes(k))) return 'Trading & derivatives';
  if (['yield', 'vault', 'farm', 'aggregator', 'curator', 'allocator', 'liquidity manager', 'governance incentive'].some((k) => c.includes(k))) return 'Yield & vaults';
  if (c.includes('stak') || c.includes('restak')) return 'Staking & restaking';
  if (['bridge', 'chain', 'cross', 'interop'].some((k) => c.includes(k))) return 'Chains & bridging';
  if (['pay', 'stable', 'rwa', 'money', 'reserve', 'card', 'insurance', 'treasury'].some((k) => c.includes(k))) return 'Money & payments';
  return null;
}

/** The peer ratios of the snapshot: traded protocols' mcap / TVL, 0 < ratio <= 50, never CEX. */
export interface PeerSet {
  byCategory: Map<string, number[]>;
  byFamily: Map<string, number[]>;
  market: number[];
}

export function peerRatios(snapshot: Snapshot): PeerSet {
  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  const market: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0 && ratio <= MODEL.peer_ratio_cap)) continue;
    market.push(ratio);
    const cat = p.category ?? 'Uncategorised';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(ratio);
    const fam = familyOf(p.category);
    if (fam !== null) {
      if (!byFamily.has(fam)) byFamily.set(fam, []);
      byFamily.get(fam)!.push(ratio);
    }
  }
  return { byCategory, byFamily, market };
}

/** A category's base multiple: category median, else family median, else market median. */
export function baseMultipleFor(category: string | null, peers: PeerSet): { multiple: number; peerCount: number; source: MultipleSource } {
  const catKey = category ?? 'Uncategorised';
  const catRatios = peers.byCategory.get(catKey) ?? [];
  if (catRatios.length >= MODEL.min_peers) {
    return { multiple: median(catRatios)!, peerCount: catRatios.length, source: 'category' };
  }
  const fam = familyOf(category);
  const famRatios = fam !== null ? peers.byFamily.get(fam) ?? [] : [];
  if (famRatios.length >= MODEL.min_peers) {
    return { multiple: median(famRatios)!, peerCount: famRatios.length, source: 'family' };
  }
  return { multiple: median(peers.market)!, peerCount: peers.market.length, source: 'market' };
}

/** The implied value of one protocol under radar-2, with its build-up. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  base: { multiple: number },
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * base.multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('liquidity manager')) {
    return `Deposit $${capital} into a ${name} curator vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit') || c.includes('borrow')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and make one swap through it.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('deriv') || c.includes('option') || c.includes('synthetic') || c.includes('predict')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} to ${name}'s chain, swap once, and use one native app on the chain each week.`;
  }
  if (c.includes('pay') || c.includes('stable') || c.includes('card')) {
    return `Hold $${capital} in ${name}'s stable asset on ${chain} and make one payment or transfer with it.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  }
  if (c.includes('farm') || c.includes('yield') || c.includes('aggregator')) {
    return `Deposit $${capital} into ${name}'s highest-TVL yield vault on ${chain} and keep the shares.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: the action, then its cost and time, within 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 200 ? 8 : 4;
  return [
    stepText(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText(
      'Repeat one qualifying action each week, such as a deposit, a swap, a borrow, a vote or a claim.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      "Check points or rewards only on the protocol's own site, reached from its official links; never pay to claim, and never trust a link sent to you.",
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      'Write the wallet address, the dates, the amounts and every transaction hash in a farm log, so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

/** The ranked board: the whole watchlist plus the 160 rankable pre-token protocols below the floor, by TVL. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerRatios(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const base = baseMultipleFor(p.category, peers);
    const v = impliedValue(p, snapshot.as_of, base);
    return { p, base, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_per_tvl: round4(s.v.implied / s.p.tvl_usd),
    base_multiple: round6(s.base.multiple),
    peer_count: s.base.peerCount,
    multiple_source: s.base.source,
    watchlist: snapshot.watchlist.includes(s.p.slug),
    growth_pct: round4(s.v.growthPct),
    growth_multiplier: round4(s.v.growthMult),
    maturity_multiplier: round4(s.v.maturityMult),
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's comparables table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** The per-category multiples table: the effective multiple each board category was scored with. */
export function multiplesTable(snapshot: Snapshot, board: BoardRow[]): MultipleRow[] {
  const peers = peerRatios(snapshot);
  const cats = [...new Set(board.map((r) => r.category ?? 'Uncategorised'))].sort();
  return cats.map((cat) => {
    const base = baseMultipleFor(cat === 'Uncategorised' ? null : cat, peers);
    return { category: cat, peers: base.peerCount, multiple: round4(base.multiple), source: base.source };
  });
}

/** The honest caveats the dashboard prints under the methodology. */
export const CAVEATS: string[] = [
  'An implied value is a comparable-based estimate, not a prediction: it says what a token might be worth if the protocol issued one at its peers\u2019 multiple, not that it will.',
  'Most protocols on this board may never issue a token. A protocol records no token in this snapshot; that is not proof it has none.',
  'Multiples come from the same snapshot\u2019s traded protocols. A category with fewer than four traded peers falls back to its family median, then to the whole-market median.',
  'Farm plans are generic steps, not financial advice. Never pay to claim an airdrop, and only use links the protocol itself publishes.',
];

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    protocols_scanned: snapshot.protocols.length,
    combined_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board,
    live,
    multiples: multiplesTable(snapshot, board),
    caveats: CAVEATS,
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
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's data as one script: the whole dataset, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
