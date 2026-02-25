const { getAuthUser } = require("../lib/auth.js");
const supabase = require("../lib/supabase.js");

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET /api/leagues?code=ABC123 — lookup by invite code (no auth needed)
  if (req.method === "GET" && req.query.code) {
    const { data: league } = await supabase
      .from("leagues")
      .select("*, league_members(count)")
      .eq("invite_code", req.query.code.toUpperCase())
      .single();

    if (!league) return res.status(404).json({ error: "League not found" });
    return res.json({ ok: true, league });
  }

  // GET /api/leagues?public=true — list public leagues (no auth needed)
  if (req.method === "GET" && req.query.public === "true") {
    const { data: leagues } = await supabase
      .from("leagues")
      .select("*, league_members(count)")
      .eq("is_public", true)
      .gte("season_end", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    return res.json({ ok: true, leagues: leagues || [] });
  }

  // All other routes need auth
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // GET /api/leagues — list user's leagues
  if (req.method === "GET") {
    // If league_id provided, return single league detail
    if (req.query.league_id) {
      const { data: league } = await supabase
        .from("leagues")
        .select("*")
        .eq("id", req.query.league_id)
        .single();

      if (!league) return res.status(404).json({ error: "League not found" });

      // Check membership
      const { data: membership } = await supabase
        .from("league_members")
        .select("*")
        .eq("league_id", league.id)
        .eq("user_id", user.id)
        .single();

      // Get member count
      const { count } = await supabase
        .from("league_members")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id);

      return res.json({
        ok: true,
        league: { ...league, member_count: count },
        membership,
      });
    }

    // List all leagues user belongs to
    const { data: memberships } = await supabase
      .from("league_members")
      .select("league_id, current_bankroll, joined_at")
      .eq("user_id", user.id);

    if (!memberships || memberships.length === 0) {
      return res.json({ ok: true, leagues: [] });
    }

    const leagueIds = memberships.map((m) => m.league_id);
    const { data: leagues } = await supabase
      .from("leagues")
      .select("*")
      .in("id", leagueIds)
      .order("created_at", { ascending: false });

    // Enrich with membership data and member counts
    const enriched = await Promise.all(
      (leagues || []).map(async (league) => {
        const mem = memberships.find((m) => m.league_id === league.id);
        const { count } = await supabase
          .from("league_members")
          .select("*", { count: "exact", head: true })
          .eq("league_id", league.id);

        // Get user's rank in this league
        const { data: allMembers } = await supabase
          .from("league_members")
          .select("user_id, current_bankroll")
          .eq("league_id", league.id)
          .order("current_bankroll", { ascending: false });

        const rank =
          (allMembers || []).findIndex((m) => m.user_id === user.id) + 1;

        return {
          ...league,
          current_bankroll: mem?.current_bankroll,
          member_count: count,
          rank,
        };
      })
    );

    return res.json({ ok: true, leagues: enriched });
  }

  // POST /api/leagues — create or join
  if (req.method === "POST") {
    const { action } = req.body || {};

    // JOIN a league
    if (action === "join") {
      const { invite_code, league_id } = req.body;

      let league;
      if (invite_code) {
        const { data } = await supabase
          .from("leagues")
          .select("*")
          .eq("invite_code", invite_code.toUpperCase())
          .single();
        league = data;
      } else if (league_id) {
        const { data } = await supabase
          .from("leagues")
          .select("*")
          .eq("id", league_id)
          .single();
        league = data;
      }

      if (!league) return res.status(404).json({ error: "League not found" });

      // Check if already a member
      const { data: existing } = await supabase
        .from("league_members")
        .select("id")
        .eq("league_id", league.id)
        .eq("user_id", user.id)
        .single();

      if (existing) {
        return res.status(409).json({ error: "Already a member" });
      }

      // Check if season ended
      if (new Date(league.season_end) < new Date()) {
        return res.status(400).json({ error: "Season has ended" });
      }

      const { error } = await supabase.from("league_members").insert({
        league_id: league.id,
        user_id: user.id,
        current_bankroll: league.bankroll,
      });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, league });
    }

    // CREATE a new league
    const { name, description, category, bankroll, season_end, is_public } =
      req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "League name required" });
    }
    if (!season_end) {
      return res.status(400).json({ error: "Season end date required" });
    }

    const invite_code = generateInviteCode();
    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        name: name.trim(),
        description: description || null,
        category: category || "all",
        bankroll: bankroll || 10000,
        season_end,
        invite_code,
        is_public: is_public || false,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-join creator
    await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: user.id,
      current_bankroll: league.bankroll,
    });

    return res.json({ ok: true, league });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
