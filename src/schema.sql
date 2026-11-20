CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  starts_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  price    INTEGER NOT NULL CHECK (price >= 0),
  quota    INTEGER NOT NULL CHECK (quota > 0),
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  event_id       UUID NOT NULL REFERENCES events(id),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id),
  quantity       INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 4),
  total_price    INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED')),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_user_event ON orders (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_orders_type_status ON orders (ticket_type_id, status);

-- Satu baris per tiket. UNIQUE (order_id, seq) = lapisan terakhir yang
-- mencegah satu pesanan menerbitkan tiket dua kali.
CREATE TABLE IF NOT EXISTS tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id),
  seq        INTEGER NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

-- Catatan webhook yang sudah diproses (kunci idempotency = id event dari provider).
CREATE TABLE IF NOT EXISTS payment_events (
  provider_event_id TEXT PRIMARY KEY,
  order_id          UUID,
  status            TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
