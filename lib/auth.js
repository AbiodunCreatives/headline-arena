const supabase = require("./supabase.js");

let privy = null;

function getPrivy() {
  if (!privy && process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    const { PrivyClient } = require("@privy-io/server-auth");
    privy = new PrivyClient(
      process.env.PRIVY_APP_ID,
      process.env.PRIVY_APP_SECRET
    );
  }
  return privy;
}

/**
 * Verify Privy token and return the Supabase user.
 * Creates user in DB on first login.
 * Falls back to demo mode if Privy is not configured.
 */
async function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");

  // Demo mode — token starts with "demo_token_"
  if (token.startsWith("demo_token_")) {
    const demoId = token.replace("demo_token_", "");

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("privy_id", demoId)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ privy_id: demoId })
        .select()
        .single();

      if (error) throw error;
      user = newUser;
    }

    return user;
  }

  // Real Privy auth
  const privyClient = getPrivy();
  if (!privyClient) return null;

  try {
    const claims = await privyClient.verifyAuthToken(token);
    const privyId = claims.userId;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("privy_id", privyId)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ privy_id: privyId })
        .select()
        .single();

      if (error) throw error;
      user = newUser;
    }

    return user;
  } catch (err) {
    console.error("Auth error:", err.message);
    return null;
  }
}

module.exports = { getAuthUser };
