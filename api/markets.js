// Fetches live Kalshi markets with in-memory caching
// Ported from headline-odds-tool/api/match.js

const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";
const CACHE_TTL = 5 * 60 * 1000;
let marketCache = { data: [], ts: 0 };

async function getAllMarkets() {
  const now = Date.now();
  if (marketCache.data.length && now - marketCache.ts < CACHE_TTL) {
    return marketCache.data;
  }

  const allMarkets = [];
  let cursor = null;

  for (let i = 0; i < 4; i++) {
    const params = new URLSearchParams({
      limit: "200",
      status: "open",
      with_nested_markets: "true",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${KALSHI_API}/events?${params}`);
    if (!res.ok) throw new Error(`Kalshi API ${res.status}`);
    const json = await res.json();

    for (const event of json.events || []) {
      for (const m of event.markets || []) {
        const close = m.close_time || m.expected_expiration_time;
        if (close && new Date(close).getTime() < Date.now()) continue;

        const seriesTicker =
          event.series_ticker || event.event_ticker || "";

        allMarkets.push({
          ticker: m.ticker,
          title: m.title || event.title,
          subtitle: m.subtitle || event.sub_title || "",
          category: event.category || "",
          event_title: event.title || "",
          yes_bid: m.yes_bid,
          no_bid: m.no_bid,
          last_price: m.last_price,
          volume: m.volume,
          close_time: close,
          status: m.status,
          url: seriesTicker
            ? `https://kalshi.com/markets/${seriesTicker}`
            : m.ticker
              ? `https://kalshi.com/markets/${m.ticker}`
              : "https://kalshi.com/markets",
        });
      }
    }

    cursor = json.cursor;
    if (!cursor || (json.events || []).length < 200) break;
  }

  marketCache = { data: allMarkets, ts: Date.now() };
  return allMarkets;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "GET only" });

  try {
    const markets = await getAllMarkets();
    const category = req.query.category;

    const filtered = category && category !== "all"
      ? markets.filter(
          (m) => m.category.toLowerCase() === category.toLowerCase()
        )
      : markets;

    // Sort by volume desc for relevance
    filtered.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    return res.json({
      ok: true,
      markets: filtered.slice(0, 100),
      count: filtered.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
