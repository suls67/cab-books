CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entries_driver_id ON entries(driver_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers can manage own entries"
  ON entries FOR ALL
  USING (
    driver_id IN (
      SELECT id FROM drivers WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    driver_id IN (
      SELECT id FROM drivers WHERE auth_user_id = auth.uid()
    )
  );
