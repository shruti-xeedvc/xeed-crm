-- Xeed CRM Initial Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'analyst' CHECK (role IN ('admin', 'analyst')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  brand VARCHAR(255),
  founders TEXT[] DEFAULT '{}',
  sector VARCHAR(255),
  location VARCHAR(255),
  funding_ask VARCHAR(255),
  stage VARCHAR(50) DEFAULT 'Sourcing' CHECK (stage IN (
    'Sourcing', 'Screening', 'Diligence', 'Term Sheet', 'Invested', 'Passed'
  )),
  priority VARCHAR(50) DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
  ai_score INTEGER CHECK (ai_score BETWEEN 1 AND 10),
  notes TEXT,
  date_added DATE DEFAULT CURRENT_DATE,
  email_source_id VARCHAR(255),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gmail_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  gmail_email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_emails (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE NOT NULL,
  subject TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  status VARCHAR(50) CHECK (status IN ('added', 'duplicate', 'skipped', 'error'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  emails_scanned INTEGER DEFAULT 0,
  deals_added INTEGER DEFAULT 0,
  deals_skipped INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  error_message TEXT
);

-- Auto-update updated_at on deals
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_updated_at ON deals;
CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS gmail_tokens_updated_at ON gmail_tokens;
CREATE TRIGGER gmail_tokens_updated_at
  BEFORE UPDATE ON gmail_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_sector ON deals(sector);
CREATE INDEX IF NOT EXISTS idx_deals_date_added ON deals(date_added DESC);
CREATE INDEX IF NOT EXISTS idx_processed_emails_message_id ON processed_emails(message_id);
