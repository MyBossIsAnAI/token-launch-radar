// radar-2: a comparable-multiples model for pre-token protocols.
//
// Idea: a protocol without a token has no market price, but traded peers in
// the same category do. Their market-cap-to-TVL ratio is a rough yardstick
// for what the market pays per dollar of locked value. Take the median ratio
// of a category's traded peers, adjust for recent TVL momentum and for how
// long the protocol has been around, and you get an implied launch value —
// an estimate, never a prediction.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  implied_value_usd: number;
  implied_per_tvl: number;
  base_multiple: number;
  peer_count: number;
  multiple_source: 'category' | 'family' | 'market';
  watchlist: boolean;
  age_days: number | null;
  farm_plan: string[];
}

export interface Comparable {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface CategoryMultiple {
  category: string;
  peer_count: number;
  median_multiple: number;
  source: 'category' | 'family' | 'market';
}

export interface RadarResult {
  model: string;
  as_of: string;
  scanned: number;
  rows: BoardRow[];
  watchlist_covered: number;
  watchlist_total: number;
  combined_implied_usd: number;
  comparables: Comparable[];
  multiples: CategoryMultiple[];
  caveats: string[];
}

const MAX_RATIO = 50;
const MIN_CATEGORY_PEERS = 4;
const BOARD_ROWS = 200;
const WATCHLIST_ROWS = 40;

/**
 * Product types that are not token launches at all: centralised exchanges,
 * bridges and staked or wrapped products of something else. Their "TVL" is
 * exchange balances or another protocol's assets, so ranking them as
 * launches would put Bybit and WBTC at the top of the board. Watchlist rows
 * are already vetted, so this filter only shapes the extra 160 rows.
 */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whether a pre-token protocol is a plausible token launch at all. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return p.category === null || !EXCLUDED_CATEGORIES.has(p.category);
}

/** Median of a non-empty number list; NaN when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp a number into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The family a category belongs to, matched on keywords in the category
 * name. Families are the fallback level when a category has too few traded
 * peers of its own to give a stable median.
 */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('credit')) return 'Lending & credit';
  if (c.includes('dex') || c.includes('deriv') || c.includes('perp') || c.includes('option') || c.includes('trad') || c.includes('predict') || c.includes('farm')) return 'Trading & derivatives';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocat') || c.includes('manager') || c.includes('basis')) return 'Yield & vaults';
  if (c.includes('stak') || c.includes('restak')) return 'Staking & restaking';
  if (c.includes('chain') || c.includes('bridge')) return 'Chains & bridging';
  if (c.includes('payment') || c.includes('rwa') || c.includes('money') || c.includes('stable')) return 'Money & payments';
  return 'Other';
}

/** Days between the snapshot date and a protocol's first listing; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/**
 * Momentum factor from the 7-day TVL change: a protocol growing fast gets a
 * modest uplift, one shrinking fast a modest haircut, both capped.
 */
export function growthFactor(change7d: number | null): number {
  const change = change7d ?? 0;
  return 1 + (clamp(change, -60, 120) / 100) * 0.5;
}

/**
 * Maturity factor from age: a brand-new protocol starts at 0.6 and earns up
 * to 1.0 after three years. Unknown age counts as one year.
 */
export function maturityFactor(age: number | null): number {
  const days = age ?? 365;
  return 0.6 + (Math.min(days, 1095) / 1095) * 0.4;
}

/** A protocol has no token when both the CoinGecko id and the ticker are absent. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A protocol trades when it carries a market cap. */
function isTraded(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

/**
 * Collect the traded peers' mcap/TVL ratios, grouped by category and by
 * family. Ratios outside (0, 50] are discarded as outliers, and CEX
 * protocols are excluded entirely — exchange tokens price a business, not
 * a protocol's locked value.
 */
function peerRatios(protocols: SnapshotProtocol[]): {
  byCategory: Map<string, number[]>;
  byFamily: Map<string, number[]>;
  market: number[];
} {
  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  const market: number[] = [];
  for (const p of protocols) {
    if (!isTraded(p) || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    if (!(ratio > 0 && ratio <= MAX_RATIO)) continue;
    const cat = p.category ?? 'Uncategorized';
    const list = byCategory.get(cat) ?? [];
    list.push(ratio);
    byCategory.set(cat, list);
    const fam = familyOf(p.category);
    const flist = byFamily.get(fam) ?? [];
    flist.push(ratio);
    byFamily.set(fam, flist);
    market.push(ratio);
  }
  return { byCategory, byFamily, market };
}

/**
 * Resolve the base multiple for a category: its own median when it has at
 * least four traded peers, else its family's median, else the market median.
 */
export function resolveMultiple(
  category: string | null,
  peers: ReturnType<typeof peerRatios>,
): { multiple: number; peerCount: number; source: 'category' | 'family' | 'market' } {
  const cat = category ?? 'Uncategorized';
  const own = peers.byCategory.get(cat) ?? [];
  if (own.length >= MIN_CATEGORY_PEERS) {
    return { multiple: median(own), peerCount: own.length, source: 'category' };
  }
  const fam = peers.byFamily.get(familyOf(category)) ?? [];
  if (fam.length >= MIN_CATEGORY_PEERS) {
    return { multiple: median(fam), peerCount: fam.length, source: 'family' };
  }
  return { multiple: median(peers.market), peerCount: peers.market.length, source: 'market' };
}

/** Capital band for a farm plan, tiered by the protocol's TVL. */
function capitalBand(tvl: number): string {
  if (tvl >= 1_000_000_000) return '$200 to $250';
  if (tvl >= 250_000_000) return '$150 to $200';
  if (tvl >= 100_000_000) return '$100 to $150';
  return '$50 to $100';
}

/** The core onchain action for a protocol's category, in plain words. */
function coreAction(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('vault') || c.includes('yield') || c.includes('allocat')) {
    return 'deposit into a curator vault on the protocol and keep the position open';
  }
  if (c.includes('lend') || c.includes('cdp')) {
    return 'supply an asset to the lending market and borrow a small amount against it';
  }
  if (c.includes('dex') || c.includes('trad') || c.includes('perp') || c.includes('deriv')) {
    return 'add liquidity to a core pool and run a few swaps through the protocol each week';
  }
  if (c.includes('bridge') || c.includes('chain')) {
    return 'bridge assets through the protocol and use an app on the destination chain';
  }
  if (c.includes('stak') || c.includes('restak')) {
    return 'stake through the protocol and leave the stake working for several weeks';
  }
  if (c.includes('rwa')) {
    return 'hold a tokenised real-world asset position on the protocol';
  }
  if (c.includes('payment') || c.includes('money') || c.includes('stable')) {
    return 'route a real payment or settlement through the protocol';
  }
  if (c.includes('basis')) {
    return 'open a small basis position and keep it delta-neutral';
  }
  return 'use the protocol directly — deposit, swap or interact with its core feature';
}

/**
 * Six farm steps for one protocol. Every step stays between 20 and 600
 * characters: a real action, a capital band, a weekly cadence, a hold
 * window, a safety reminder and a record-keeping step.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const name = p.name;
  const capital = capitalBand(p.tvl_usd);
  const holdWeeks = clamp(Math.round((age ?? 365) / 30), 4, 26);
  const action = coreAction(p.category);
  return [
    `Start on ${name}: open its official app from its own site or docs, connect a fresh wallet you control, and ${action}.`,
    `Size the position at ${capital} in total value — enough to register as a real user, small enough that a loss would not hurt.`,
    `Come back every week and repeat the core action at least once, so the activity reads as sustained use rather than a single visit.`,
    `Keep the position open for at least ${holdWeeks} weeks; do not deposit and withdraw in the same session, which looks like farming for its own sake.`,
    `Only ever follow links from the protocol's own official channels. Never sign a transaction you do not understand, and never share a seed phrase with anyone.`,
    `Write down every deposit, withdrawal and transaction hash with dates, so you can prove the activity later and report it correctly for tax.`,
  ];
}

/**
 * A small set of traded protocols the multiples were drawn from, so the
 * dashboard can show the live comparables behind each estimate.
 */
function liveComparables(protocols: SnapshotProtocol[]): Comparable[] {
  const traded = protocols
    .filter((p) => isTraded(p) && p.tvl_usd > 0 && p.category !== 'CEX')
    .filter((p) => {
      const r = p.mcap_usd! / p.tvl_usd;
      return r > 0 && r <= MAX_RATIO;
    })
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  const seen = new Set<string>();
  const out: Comparable[] = [];
  for (const p of traded) {
    const cat = p.category ?? 'Uncategorized';
    if (seen.has(cat) && out.filter((c) => c.category === cat).length >= 3) continue;
    seen.add(cat);
    out.push({
      slug: p.slug,
      name: p.name,
      category: cat,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.mcap_usd! / p.tvl_usd,
    });
    if (out.length >= 60) break;
  }
  return out.sort((a, b) => b.mcap_usd - a.mcap_usd);
}

/** One multiples-table row per category that has any traded peers. */
function multiplesTable(peers: ReturnType<typeof peerRatios>): CategoryMultiple[] {
  const rows: CategoryMultiple[] = [];
  for (const [category, ratios] of [...peers.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const resolved = resolveMultiple(category, peers);
    rows.push({ category, peer_count: ratios.length, median_multiple: median(ratios), source: resolved.source });
  }
  return rows;
}

/**
 * Build the whole radar from a snapshot: the 200-row board (all 40
 * watchlist protocols plus the top 160 other rankable pre-token protocols),
 * the comparables, the multiples table and the caveats.
 */
export function buildRadar(snapshot: Snapshot): RadarResult {
  const peers = peerRatios(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const candidates = new Set(snapshot.protocols.filter(isLaunchCandidate).map((p) => p.slug));
  const asOf = snapshot.as_of;

  const scored: Omit<BoardRow, 'rank'>[] = [];
  for (const p of snapshot.protocols) {
    if (!hasNoToken(p)) continue;
    const resolved = resolveMultiple(p.category, peers);
    const age = ageDays(asOf, p.listed_at);
    const growth = growthFactor(p.change_7d);
    const maturity = maturityFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * resolved.multiple * growth * maturity));
    scored.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      implied_value_usd: implied,
      implied_per_tvl: implied / p.tvl_usd,
      base_multiple: resolved.multiple,
      peer_count: resolved.peerCount,
      multiple_source: resolved.source,
      watchlist: watchlist.has(p.slug),
      age_days: age,
      farm_plan: farmPlan(p, age),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd);

  const watchRows = scored.filter((r) => r.watchlist);
  const rest = scored
    .filter((r) => !r.watchlist && candidates.has(r.slug))
    .slice(0, BOARD_ROWS - WATCHLIST_ROWS);
  const chosen = [...watchRows, ...rest].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const rows: BoardRow[] = chosen.map((r, i) => ({ ...r, rank: i + 1 }));

  const combined = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  return {
    model: 'radar-2',
    as_of: asOf,
    scanned: snapshot.protocols.length,
    rows,
    watchlist_covered: watchRows.length,
    watchlist_total: snapshot.watchlist.length,
    combined_implied_usd: combined,
    comparables: liveComparables(snapshot.protocols),
    multiples: multiplesTable(peers),
    caveats: [
      'An implied value is a comparable-based estimate, not a prediction of a future token price or market cap.',
      'Most protocols on this board may never issue a token; a high implied value does not mean a launch is coming.',
      'Peer multiples come from traded protocols in the same category or family and can move sharply with the market.',
      'TVL can be inflated by incentives, mercenary capital or double-counted deposits, which would overstate an implied value.',
      'Farm plans describe ordinary onchain use; they do not guarantee any airdrop or reward.',
    ],
  };
}
