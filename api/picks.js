import { getAuthUser } from "../lib/auth.js";
import supabase from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // GET /api/picks?league_id=X — get user's picks in a league
  if (req.method === "GET") {
    const { league_id } = req.query;
    if (!league_id) {
      return res.status(400).json({ error: "league_id required" });
    }

    const { data: picks } = await supabase
      .from("picks")
      .select("*")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return res.json({ ok: true, picks: picks || [] });
  }

  // POST /api/picks — submit a new pick
  if (req.method === "POST") {
    const {
      league_id,
      market_ticker,
      market_title,
      direction,
      entry_price,
      amount,
    } = req.body || {};

    // Validate inputs
    if (!league_id || !market_ticker || !market_title || !direction || !entry_price || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["yes", "no"].includes(direction)) {
      return res.status(400).json({ error: "Direction must be yes or no" });
    }
    if (amount < 1) {
      return res.status(400).json({ error: "Amount must be at least $1" });
    }
    if (entry_price < 1 || entry_price > 99) {
      return res.status(400).json({ error: "Invalid entry price" });
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("league_members")
      .select("*")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return res.status(403).json({ error: "Not a member of this league" });
    }

    // Check bankroll
    if (membership.current_bankroll < amount) {
      return res.status(400).json({ error: "Insufficient bankroll" });
    }

    // Check for duplicate active pick on same market in same league
    const { data: existingPick } = await supabase
      .from("picks")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .eq("market_ticker", market_ticker)
      .eq("status", "active")
      .single();

    if (existingPick) {
      return res.status(409).json({ error: "Already have an active pick on this market" });
    }

    // Create pick
    const { data: pick, error: pickError } = await supabase
      .from("picks")
      .insert({
        league_id,
        user_id: user.id,
        market_ticker,
        market_title,
        direction,
        entry_price,
        amount,
        status: "active",
      })
      .select()
      .single();

    if (pickError) return res.status(500).json({ error: pickError.message });

    // Deduct from bankroll
    const { error: updateError } = await supabase
      .from("league_members")
      .update({
        current_bankroll: membership.current_bankroll - amount,
      })
      .eq("id", membership.id);

    if (updateError) {
      // Rollback pick if bankroll update fails
      await supabase.from("picks").delete().eq("id", pick.id);
      return res.status(500).json({ error: "Failed to update bankroll" });
    }

    return res.json({
      ok: true,
      pick,
      remaining_bankroll: membership.current_bankroll - amount,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
