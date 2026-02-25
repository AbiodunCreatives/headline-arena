-- Headline Arena — Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Users table
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_id text UNIQUE NOT NULL,
  username text UNIQUE,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_users_privy_id ON users(privy_id);

-- 2. Leagues table
CREATE TABLE leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text DEFAULT 'all',
  bankroll integer DEFAULT 10000,
  season_start timestamptz DEFAULT now(),
  season_end timestamptz NOT NULL,
  invite_code text UNIQUE NOT NULL,
  is_public boolean DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_leagues_invite_code ON leagues(invite_code);
CREATE INDEX idx_leagues_public ON leagues(is_public) WHERE is_public = true;

-- 3. League members table
CREATE TABLE league_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  current_bankroll integer NOT NULL,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(league_id, user_id)
);

CREATE INDEX idx_league_members_league ON league_members(league_id);
CREATE INDEX idx_league_members_user ON league_members(user_id);

-- 4. Picks table
CREATE TABLE picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  market_ticker text NOT NULL,
  market_title text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('yes', 'no')),
  entry_price integer NOT NULL,
  amount integer NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'sold')),
  resolved_price integer,
  pnl integer,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_picks_league_user ON picks(league_id, user_id);
CREATE INDEX idx_picks_status ON picks(status) WHERE status = 'active';
CREATE INDEX idx_picks_ticker ON picks(market_ticker);

-- 5. Disable RLS for server-side access (we use service_role key)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON users FOR ALL USING (true);
CREATE POLICY "Service role full access" ON leagues FOR ALL USING (true);
CREATE POLICY "Service role full access" ON league_members FOR ALL USING (true);
CREATE POLICY "Service role full access" ON picks FOR ALL USING (true);
