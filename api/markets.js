// Fetches live markets from Bayse Markets with in-memory caching

const BAYSE_API = "https://relay.bayse.markets/v1";
const CACHE_TTL = 5 * 60 * 1000;

let bayseCache = { data: [], ts: 0 };

async function getBayseMarkets() {
  const now = Date.now();
  if (bayseCache.data.length && now - bayseCache.ts < CACHE_TTL) {
    return bayseCache.data;
  }

  const allMarkets = [];

  for (let page = 1; page <= 6; page++) {
    const res = await fetch(`${BAYSE_API}/pm/events?page=${page}&size=50`);
    if (!res.ok) break;
    const json = await res.json();
    const events = json.events || [];

    for (const event of events) {
      if (event.status !== "open") continue;

      for (const m of event.markets || []) {
        if (m.status !== "open") continue;

        // Bayse prices are 0-1 decimals, convert to cents (0-100)
        const yesBid = Math.round(
          (m.yesBuyPrice || m.outcome1Price || 0) * 100
        );
        const noBid = Math.round(
          (m.noBuyPrice || m.outcome2Price || 0) * 100
        );

        // Normalize category casing
        const rawCat = (event.category || "").trim();
        const category =
          rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase();

        allMarkets.push({
          ticker: `bayse_${m.id}`,
          title:
            event.type === "single"
              ? event.title
              : `${event.title} — ${m.title}`,
          subtitle: "",
          category:
            category === "Social media" ? "Social" : category,
          event_title: event.title,
          yes_bid: yesBid,
          no_bid: noBid,
          last_price: yesBid,
          volume: event.totalVolume || event.totalOrders || 0,
          close_time: event.closingDate || event.resolutionDate || "",
          status: m.status,
          source: "bayse",
          image: event.image128Url || event.imageUrl || "",
          url: `https://bayse.markets/event/${event.id}`,
        });
      }
    }

    if (!json.pagination || page >= json.pagination.lastPage) break;
  }

  bayseCache = { data: allMarkets, ts: Date.now() };
  return allMarkets;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "GET only" });

  try {
    const markets = await getBayseMarkets();
    const category = req.query.category;

    let filtered =
      category && category !== "all"
        ? markets.filter(
            (m) => m.category.toLowerCase() === category.toLowerCase()
          )
        : markets;

    // Fall back to all markets if category filter matches nothing
    if (filtered.length === 0 && category && category !== "all") {
      filtered = markets;
    }

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
};
