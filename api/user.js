const { getAuthUser } = require("../lib/auth.js");
const supabase = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // GET — return user profile + stats
  if (req.method === "GET") {
    // Get aggregate stats
    const { data: memberships } = await supabase
      .from("league_members")
      .select("league_id, current_bankroll")
      .eq("user_id", user.id);

    const { data: picks } = await supabase
      .from("picks")
      .select("status, pnl")
      .eq("user_id", user.id);

    const totalPicks = picks?.length || 0;
    const wonPicks = picks?.filter((p) => p.status === "won").length || 0;
    const totalPnl = picks?.reduce((sum, p) => sum + (p.pnl || 0), 0) || 0;

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
        win_rate: totalPicks > 0 ? Math.round((wonPicks / totalPicks) * 100) : 0,
        total_pnl: totalPnl,
      },
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
