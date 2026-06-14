CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  type TEXT NOT NULL DEFAULT 'Private hire' CHECK (type IN ('Private hire', 'Account work', 'School', 'Business')),
  area TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_driver_id ON customers(driver_id);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers can manage own customers"
  ON customers FOR ALL
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
