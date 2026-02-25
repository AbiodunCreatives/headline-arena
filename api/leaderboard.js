const supabase = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "GET only" });

  const { league_id } = req.query;

  // League-specific leaderboard
  if (league_id) {
    const { data: members } = await supabase
      .from("league_members")
      .select("user_id, current_bankroll, joined_at")
      .eq("league_id", league_id)
      .order("current_bankroll", { ascending: false });

    if (!members || members.length === 0) {
      return res.json({ ok: true, standings: [] });
    }

    // Get league info for starting bankroll
    const { data: league } = await supabase
      .from("leagues")
      .select("bankroll")
      .eq("id", league_id)
      .single();

    const startingBankroll = league?.bankroll || 10000;

    // Enrich with user info and pick stats
    const standings = await Promise.all(
      members.map(async (m, index) => {
        const { data: user } = await supabase
          .from("users")
          .select("username, avatar_url")
          .eq("id", m.user_id)
          .single();

        const { data: picks } = await supabase
          .from("picks")
          .select("status, pnl")
          .eq("league_id", league_id)
          .eq("user_id", m.user_id);

        const totalPicks = picks?.length || 0;
        const wonPicks = picks?.filter((p) => p.status === "won").length || 0;
        const returnPct =
          startingBankroll > 0
            ? Math.round(
                ((m.current_bankroll - startingBankroll) / startingBankroll) *
                  100
              )
            : 0;

        return {
          rank: index + 1,
          user_id: m.user_id,
          username: user?.username || `Player ${index + 1}`,
          avatar_url: user?.avatar_url,
          current_bankroll: m.current_bankroll,
          return_pct: returnPct,
          total_picks: totalPicks,
          won_picks: wonPicks,
          win_rate:
            totalPicks > 0 ? Math.round((wonPicks / totalPicks) * 100) : 0,
        };
      })
    );

    return res.json({ ok: true, standings });
  }

  // Global leaderboard — top players across all leagues
  const { data: allMembers } = await supabase
    .from("league_members")
    .select("user_id, current_bankroll, league_id");

  if (!allMembers || allMembers.length === 0) {
    return res.json({ ok: true, standings: [] });
  }

  // Aggregate by user
  const userMap = {};
  for (const m of allMembers) {
    if (!userMap[m.user_id]) {
      userMap[m.user_id] = {
        user_id: m.user_id,
        total_bankroll: 0,
        league_count: 0,
      };
    }
    userMap[m.user_id].total_bankroll += m.current_bankroll;
    userMap[m.user_id].league_count++;
  }

  const sorted = Object.values(userMap)
    .sort((a, b) => b.total_bankroll - a.total_bankroll)
    .slice(0, 50);

  // Enrich with user info
  const standings = await Promise.all(
    sorted.map(async (entry, index) => {
      const { data: user } = await supabase
        .from("users")
        .select("username, avatar_url")
        .eq("id", entry.user_id)
        .single();

      const { data: picks } = await supabase
        .from("picks")
        .select("status")
        .eq("user_id", entry.user_id);

      const totalPicks = picks?.length || 0;
      const wonPicks = picks?.filter((p) => p.status === "won").length || 0;

      return {
        rank: index + 1,
        user_id: entry.user_id,
        username: user?.username || `Player`,
        avatar_url: user?.avatar_url,
        total_bankroll: entry.total_bankroll,
        league_count: entry.league_count,
        total_picks: totalPicks,
        win_rate:
          totalPicks > 0 ? Math.round((wonPicks / totalPicks) * 100) : 0,
      };
    })
  );

  return res.json({ ok: true, standings });
}
