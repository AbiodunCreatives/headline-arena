const { getAuthUser } = require("../lib/auth.js");
const supabase = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // GET — return user profile + stats + dashboard data
  if (req.method === "GET") {
    // Get memberships with league info
    const { data: memberships } = await supabase
      .from("league_members")
      .select("league_id, current_bankroll")
      .eq("user_id", user.id);

    // Get all picks
    const { data: picks } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    // Get league details for bankroll calculations
    const leagueIds = (memberships || []).map((m) => m.league_id);
    let leagues = [];
    if (leagueIds.length > 0) {
      const { data } = await supabase
        .from("leagues")
        .select("id, name, bankroll, season_end")
        .in("id", leagueIds);
      leagues = data || [];
    }

    const totalPicks = picks?.length || 0;
    const activePicks = picks?.filter((p) => p.status === "active") || [];
    const wonPicks = picks?.filter((p) => p.status === "won") || [];
    const lostPicks = picks?.filter((p) => p.status === "lost") || [];
    const resolvedPicks = wonPicks.length + lostPicks.length;
    const totalPnl = picks?.reduce((sum, p) => sum + (p.pnl || 0), 0) || 0;

    // Calculate total portfolio value (sum of all league bankrolls)
    const totalBankroll = (memberships || []).reduce(
      (sum, m) => sum + (m.current_bankroll || 0),
      0
    );
    // Calculate total starting bankroll
    const totalStarting = (memberships || []).reduce((sum, m) => {
      const league = leagues.find((l) => l.id === m.league_id);
      return sum + (league?.bankroll || 0);
    }, 0);

    // Active amount at risk
    const activeAmount = activePicks.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    // Best pick (highest PnL)
    const bestPick = [...(picks || [])]
      .filter((p) => p.pnl != null)
      .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))[0] || null;

    // Recent picks (last 5)
    const recentPicks = (picks || []).slice(0, 5);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
      },
      stats: {
        leagues: memberships?.length || 0,
        total_picks: totalPicks,
        active_picks: activePicks.length,
        resolved_picks: resolvedPicks,
        won_picks: wonPicks.length,
        lost_picks: lostPicks.length,
        win_rate:
          resolvedPicks > 0
            ? Math.round((wonPicks.length / resolvedPicks) * 100)
            : 0,
        total_pnl: totalPnl,
        total_bankroll: totalBankroll,
        total_starting: totalStarting,
        return_pct:
          totalStarting > 0
            ? Math.round(
                ((totalBankroll - totalStarting) / totalStarting) * 100
              )
            : 0,
        active_amount: activeAmount,
        best_pick: bestPick
          ? {
              market_title: bestPick.market_title,
              direction: bestPick.direction,
              pnl: bestPick.pnl,
            }
          : null,
      },
      recent_picks: recentPicks.map((p) => ({
        id: p.id,
        market_title: p.market_title,
        market_ticker: p.market_ticker,
        direction: p.direction,
        entry_price: p.entry_price,
        amount: p.amount,
        status: p.status,
        pnl: p.pnl,
        created_at: p.created_at,
      })),
    });
  }

  // PUT — update username/avatar
  if (req.method === "PUT") {
    const { username, avatar_url } = req.body || {};
    const updates = {};
    if (username) updates.username = username.trim().slice(0, 20);
    if (avatar_url) updates.avatar_url = avatar_url;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Username already taken" });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, user: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
