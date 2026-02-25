import { PrivyClient } from "@privy-io/server-auth";
import supabase from "./supabase.js";

const privy = new PrivyClient(
  process.env.PRIVY_APP_ID,
  process.env.PRIVY_APP_SECRET
);

/**
 * Verify Privy token and return the Supabase user.
 * Creates user in DB on first login.
 */
export async function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const claims = await privy.verifyAuthToken(token);
    const privyId = claims.userId;

    // Look up existing user
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("privy_id", privyId)
      .single();

    // Create user on first login
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
