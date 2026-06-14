CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  date DATE NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  notes TEXT,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoices_driver_id ON invoices(driver_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers can manage own invoices"
  ON invoices FOR ALL
  USING (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()))
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid()));

CREATE POLICY "drivers can manage own invoice items"
  ON invoice_items FOR ALL
  USING (invoice_id IN (SELECT id FROM invoices WHERE driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid())))
  WITH CHECK (invoice_id IN (SELECT id FROM invoices WHERE driver_id IN (SELECT id FROM drivers WHERE auth_user_id = auth.uid())));
