-- ─────────────────────────────────────────────────────────────
-- 0004 — Sprint 6: Paid checkout (US-2.2.2) & certificates (US-5.1.2)
-- ─────────────────────────────────────────────────────────────

-- Course-level certificate requirement (US-5.1.2: "minimum quiz grade met").
ALTER TABLE courses
  ADD COLUMN certificate_pass_percent integer NOT NULL DEFAULT 70
  CHECK (certificate_pass_percent BETWEEN 0 AND 100);

-- Payment orders & receipts (US-2.2.2). One row per checkout; a successful
-- order grants enrolment. Receipts are returned from the learner's Orders view.
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  provider text NOT NULL,                     -- stripe | mpesa | paypal | mock
  provider_session_id text,                   -- Stripe PaymentIntent / Daraja CheckoutRequestID / PayPal order id
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  failure_reason text,
  receipt jsonb NOT NULL DEFAULT '{}',        -- provider receipt snapshot: providerFee, paymentMethod, last4, mpesaReceipt, payerName...
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_course_idx ON orders (course_id);
CREATE INDEX orders_provider_status_idx ON orders (provider, status);

-- Verifiable course-completion certificates (US-5.1.2).
CREATE TABLE certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number text NOT NULL UNIQUE,    -- public id used by /verify/{certificateNumber}
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_name text NOT NULL,
  file_key text NOT NULL,                     -- certificate PDF in the user-uploads bucket
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX certificates_user_idx ON certificates (user_id);