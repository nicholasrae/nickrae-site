-- ============================================================
-- Talos Command Center — Supabase Schema
-- Run this in Supabase SQL Editor after creating your project
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  description text,
  category text
    CHECK (category IN ('revenue', 'infrastructure', 'content', 'personal', 'aviation')),
  progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  start_date date,
  target_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- TASKS (Kanban board)
-- ============================================================
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  tags text[] DEFAULT '{}',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- CONTENT (YouTube, X/Twitter, Blog, KDP)
-- ============================================================
CREATE TABLE content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea', 'draft', 'scheduled', 'published', 'archived')),
  platform text[] DEFAULT '{}',
  content_type text
    CHECK (content_type IN ('youtube_script', 'tweet', 'thread', 'blog_post', 'kdp_chapter', 'payhip_product', 'newsletter')),
  scheduled_date timestamptz,
  published_url text,
  metrics jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- DOCUMENTS (Reference, SOPs, meeting notes)
-- ============================================================
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text,
  doc_type text
    CHECK (doc_type IN ('reference', 'sop', 'brief', 'decision', 'journal', 'voice_sample')),
  tags text[] DEFAULT '{}',
  source text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- TRADING (Paper trading P&L tracker)
-- ============================================================
CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  city text,
  temp_range text,
  direction text CHECK (direction IN ('buy_yes', 'buy_no', 'sell_yes', 'sell_no')),
  amount numeric(10,2),
  price numeric(10,4),
  edge_pct numeric(5,2),
  status text DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'settled')),
  pnl numeric(10,2),
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  notes text
);

-- ============================================================
-- CRON HEALTH (agent self-monitoring)
-- ============================================================
CREATE TABLE cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  job_id text,
  status text CHECK (status IN ('ok', 'error', 'timeout')),
  duration_ms integer,
  tokens_used integer,
  model text,
  error_message text,
  ran_at timestamptz DEFAULT now()
);

-- ============================================================
-- REVENUE (KDP + Payhip + future)
-- ============================================================
CREATE TABLE revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL
    CHECK (source IN ('kdp', 'payhip', 'youtube', 'affiliate', 'freelance', 'other')),
  product text,
  amount numeric(10,2),
  currency text DEFAULT 'USD',
  transaction_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- DAILY METRICS (daily snapshot for trends)
-- ============================================================
CREATE TABLE daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  trading_balance numeric(10,2),
  trading_pnl numeric(10,2),
  open_positions integer,
  cron_jobs_total integer,
  cron_jobs_healthy integer,
  cron_errors integer,
  tokens_used_estimate integer,
  revenue_today numeric(10,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- AUTO-UPDATE TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_content_updated BEFORE UPDATE ON content FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_documents_updated BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;

-- Service role (agent) gets full access
CREATE POLICY "service_role_all" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON content FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON cron_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON revenue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON daily_metrics FOR ALL USING (true) WITH CHECK (true);

-- Anon key (dashboard) gets read access + write to tasks/content
CREATE POLICY "anon_read" ON projects FOR SELECT USING (true);
CREATE POLICY "anon_read" ON tasks FOR SELECT USING (true);
CREATE POLICY "anon_write" ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update" ON tasks FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon_read" ON content FOR SELECT USING (true);
CREATE POLICY "anon_write" ON content FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update" ON content FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon_read" ON documents FOR SELECT USING (true);
CREATE POLICY "anon_read" ON trades FOR SELECT USING (true);
CREATE POLICY "anon_read" ON cron_runs FOR SELECT USING (true);
CREATE POLICY "anon_read" ON revenue FOR SELECT USING (true);
CREATE POLICY "anon_read" ON daily_metrics FOR SELECT USING (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_cron_runs_ran_at ON cron_runs(ran_at);
CREATE INDEX idx_daily_metrics_date ON daily_metrics(date);
CREATE INDEX idx_revenue_date ON revenue(transaction_date);
