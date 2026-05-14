BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_email_error TEXT;

CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (char_length(trim(comment)) >= 10),
  author_label TEXT NOT NULL DEFAULT 'Clienta Vasca',
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loyalty_points_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  points_delta INT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_clients_auth_user_id
  ON public.clients(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_client_id
  ON public.reviews(client_id);

CREATE INDEX IF NOT EXISTS idx_reviews_publish_state
  ON public.reviews(is_published, is_approved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_points_client_id
  ON public.loyalty_points_ledger(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.build_review_author_label(full_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  cleaned TEXT;
  parts TEXT[];
  first_name TEXT;
  last_name TEXT;
BEGIN
  cleaned := trim(COALESCE(full_name, ''));
  IF cleaned = '' THEN
    RETURN 'Clienta Vasca';
  END IF;

  parts := regexp_split_to_array(cleaned, '\s+');
  first_name := initcap(parts[1]);

  IF array_length(parts, 1) IS NULL OR array_length(parts, 1) = 1 THEN
    RETURN first_name;
  END IF;

  last_name := upper(left(parts[array_length(parts, 1)], 1));
  RETURN first_name || ' ' || last_name || '.';
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_review_author_label()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  client_name TEXT;
BEGIN
  SELECT full_name
  INTO client_name
  FROM public.clients
  WHERE id = NEW.client_id;

  NEW.author_label := public.build_review_author_label(client_name);

  IF NEW.is_published AND NEW.published_at IS NULL THEN
    NEW.published_at := NOW();
  ELSIF NOT NEW.is_published THEN
    NEW.published_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_updated ON public.reviews;
CREATE TRIGGER trg_reviews_updated
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_reviews_author ON public.reviews;
CREATE TRIGGER trg_reviews_author
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.sync_review_author_label();

CREATE OR REPLACE FUNCTION public.apply_loyalty_points_for_completed_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  award_points INT;
BEGIN
  IF NEW.status <> 'completed' OR COALESCE(OLD.status, '') = 'completed' THEN
    RETURN NEW;
  END IF;

  award_points := COALESCE(
    (
      SELECT NULLIF((value ->> 'points')::INT, 0)
      FROM public.settings
      WHERE key = 'points_per_completed_appointment'
      LIMIT 1
    ),
    10
  );

  INSERT INTO public.loyalty_points_ledger (client_id, appointment_id, points_delta, reason)
  VALUES (NEW.client_id, NEW.id, award_points, 'appointment_completed')
  ON CONFLICT (appointment_id, reason) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_loyalty_points ON public.appointments;
CREATE TRIGGER trg_apply_loyalty_points
  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.apply_loyalty_points_for_completed_appointment();

INSERT INTO public.settings (key, value, description)
VALUES
  ('points_per_completed_appointment', '{"points": 10}', 'Puntos otorgados por cada turno completado.'),
  ('reward_threshold', '{"points": 100}', 'Cantidad de puntos necesaria para desbloquear un beneficio.'),
  ('reward_label', '{"label": "$5.000 de descuento"}', 'Texto visible del beneficio vigente del programa de fidelidad.')
ON CONFLICT (key) DO NOTHING;

WITH candidate_matches AS (
  SELECT
    c.id AS client_id,
    u.id AS user_id,
    ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY u.created_at) AS rn_client,
    ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY c.created_at) AS rn_user
  FROM public.clients c
  JOIN auth.users u
    ON lower(COALESCE(c.email, '')) = lower(COALESCE(u.email, ''))
  WHERE c.auth_user_id IS NULL
    AND COALESCE(c.email, '') <> ''
)
UPDATE public.clients c
SET auth_user_id = m.user_id
FROM candidate_matches m
WHERE c.id = m.client_id
  AND m.rn_client = 1
  AND m.rn_user = 1;

DROP POLICY IF EXISTS "Admin acceso total profesionales" ON public.professionals;
CREATE POLICY "Admin acceso total profesionales"
  ON public.professionals FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total servicios" ON public.services;
CREATE POLICY "Admin acceso total servicios"
  ON public.services FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total precios" ON public.service_professional_prices;
CREATE POLICY "Admin acceso total precios"
  ON public.service_professional_prices FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total horarios" ON public.weekly_schedule;
CREATE POLICY "Admin acceso total horarios"
  ON public.weekly_schedule FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total bloqueados" ON public.blocked_dates;
CREATE POLICY "Admin acceso total bloqueados"
  ON public.blocked_dates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clientas pueden registrarse" ON public.clients;
DROP POLICY IF EXISTS "Admin acceso total clientas" ON public.clients;
DROP POLICY IF EXISTS "Clients select own record" ON public.clients;
DROP POLICY IF EXISTS "Clients insert own record" ON public.clients;
DROP POLICY IF EXISTS "Clients update own record" ON public.clients;
CREATE POLICY "Clients select own record"
  ON public.clients FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR lower(COALESCE(email, '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "Clients insert own record"
  ON public.clients FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND auth_user_id = auth.uid());

CREATE POLICY "Clients update own record"
  ON public.clients FOR UPDATE
  USING (
    auth_user_id = auth.uid()
    OR lower(COALESCE(email, '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  )
  WITH CHECK (
    auth_user_id = auth.uid()
    OR lower(COALESCE(email, '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "Admin acceso total clientas"
  ON public.clients FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Crear turnos públicamente" ON public.appointments;
DROP POLICY IF EXISTS "Admin acceso total turnos" ON public.appointments;
DROP POLICY IF EXISTS "Clients read own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Clients create own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Clients update own appointments" ON public.appointments;
CREATE POLICY "Clients read own appointments"
  ON public.appointments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = appointments.client_id
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Clients create own appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = appointments.client_id
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Clients update own appointments"
  ON public.appointments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = appointments.client_id
        AND c.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = appointments.client_id
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin acceso total turnos"
  ON public.appointments FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published reviews are public" ON public.reviews;
DROP POLICY IF EXISTS "Clients read own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Clients create own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admin acceso total reviews" ON public.reviews;
CREATE POLICY "Published reviews are public"
  ON public.reviews FOR SELECT
  USING (is_published = TRUE);

CREATE POLICY "Clients read own reviews"
  ON public.reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = reviews.client_id
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Clients create own reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      JOIN public.clients c ON c.id = a.client_id
      WHERE a.id = reviews.appointment_id
        AND a.client_id = reviews.client_id
        AND a.status = 'completed'
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin acceso total reviews"
  ON public.reviews FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.loyalty_points_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own loyalty points" ON public.loyalty_points_ledger;
DROP POLICY IF EXISTS "Admin acceso total loyalty ledger" ON public.loyalty_points_ledger;
CREATE POLICY "Clients read own loyalty points"
  ON public.loyalty_points_ledger FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = loyalty_points_ledger.client_id
        AND c.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin acceso total loyalty ledger"
  ON public.loyalty_points_ledger FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated read loyalty settings" ON public.settings;
CREATE POLICY "Authenticated read loyalty settings"
  ON public.settings FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND key IN ('points_per_completed_appointment', 'reward_threshold', 'reward_label')
  );

CREATE POLICY "Admin acceso total settings"
  ON public.settings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin acceso total historial" ON public.appointment_history;
CREATE POLICY "Admin acceso total historial"
  ON public.appointment_history FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin read all profiles" ON public.profiles;
CREATE POLICY "Admin read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE OR REPLACE VIEW public.v_client_loyalty_summary
WITH (security_invoker = on) AS
WITH loyalty_settings AS (
  SELECT
    COALESCE(
      (SELECT (value ->> 'points')::INT FROM public.settings WHERE key = 'points_per_completed_appointment' LIMIT 1),
      10
    ) AS points_per_completed_appointment,
    COALESCE(
      (SELECT (value ->> 'points')::INT FROM public.settings WHERE key = 'reward_threshold' LIMIT 1),
      100
    ) AS reward_threshold,
    COALESCE(
      (SELECT value ->> 'label' FROM public.settings WHERE key = 'reward_label' LIMIT 1),
      '$5.000 de descuento'
    ) AS reward_label
)
SELECT
  c.id AS client_id,
  c.full_name,
  COALESCE(SUM(l.points_delta), 0)::INT AS points_balance,
  COUNT(DISTINCT l.appointment_id) FILTER (WHERE l.points_delta > 0) AS rewarded_appointments,
  ls.points_per_completed_appointment,
  ls.reward_threshold,
  ls.reward_label,
  FLOOR(COALESCE(SUM(l.points_delta), 0)::NUMERIC / NULLIF(ls.reward_threshold, 0))::INT AS rewards_available,
  CASE
    WHEN ls.reward_threshold <= 0 THEN 0
    WHEN COALESCE(SUM(l.points_delta), 0)::INT = 0 THEN ls.reward_threshold
    WHEN MOD(COALESCE(SUM(l.points_delta), 0)::INT, ls.reward_threshold) = 0 THEN 0
    ELSE ls.reward_threshold - MOD(COALESCE(SUM(l.points_delta), 0)::INT, ls.reward_threshold)
  END AS points_to_next_reward,
  CASE
    WHEN ls.reward_threshold <= 0 THEN 0
    WHEN COALESCE(SUM(l.points_delta), 0)::INT = 0 THEN 0
    WHEN MOD(COALESCE(SUM(l.points_delta), 0)::INT, ls.reward_threshold) = 0 THEN 100
    ELSE ROUND(
      (MOD(COALESCE(SUM(l.points_delta), 0)::INT, ls.reward_threshold)::NUMERIC / ls.reward_threshold::NUMERIC) * 100,
      1
    )
  END AS progress_pct
FROM public.clients c
CROSS JOIN loyalty_settings ls
LEFT JOIN public.loyalty_points_ledger l ON l.client_id = c.id
GROUP BY c.id, c.full_name, ls.points_per_completed_appointment, ls.reward_threshold, ls.reward_label;

CREATE OR REPLACE VIEW public.v_admin_daily_ops
WITH (security_invoker = on) AS
WITH days AS (
  SELECT generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day')::DATE AS appointment_date
)
SELECT
  d.appointment_date,
  COALESCE(COUNT(a.id), 0)::INT AS total_appointments,
  COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'completed'), 0)::INT AS completed_appointments,
  COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'cancelled'), 0)::INT AS cancelled_appointments,
  COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'confirmed'), 0)::INT AS confirmed_appointments,
  COALESCE(COUNT(a.id) FILTER (WHERE a.status = 'pending'), 0)::INT AS pending_appointments
FROM days d
LEFT JOIN public.appointments a
  ON a.appointment_date = d.appointment_date
WHERE public.is_admin()
GROUP BY d.appointment_date
ORDER BY d.appointment_date;

CREATE OR REPLACE VIEW public.v_admin_professional_load
WITH (security_invoker = on) AS
WITH week_bounds AS (
  SELECT
    date_trunc('week', current_date::TIMESTAMP)::DATE AS week_start,
    (date_trunc('week', current_date::TIMESTAMP) + INTERVAL '6 days')::DATE AS week_end
),
schedule_minutes AS (
  SELECT
    p.id AS professional_id,
    SUM(
      GREATEST(
        EXTRACT(EPOCH FROM (ws.end_time - ws.start_time)) / 60
        - COALESCE(EXTRACT(EPOCH FROM (ws.break_end - ws.break_start)) / 60, 0),
        0
      )
    )::INT AS scheduled_minutes
  FROM public.professionals p
  LEFT JOIN public.weekly_schedule ws
    ON ws.professional_id = p.id
   AND ws.is_active = TRUE
  WHERE p.is_active = TRUE
  GROUP BY p.id
),
booked_minutes AS (
  SELECT
    a.professional_id,
    COUNT(*) FILTER (WHERE a.status <> 'cancelled')::INT AS appointment_count,
    COALESCE(SUM(
      EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 60
    ) FILTER (WHERE a.status <> 'cancelled'), 0)::INT AS booked_minutes
  FROM public.appointments a
  CROSS JOIN week_bounds wb
  WHERE a.appointment_date BETWEEN wb.week_start AND wb.week_end
  GROUP BY a.professional_id
)
SELECT
  wb.week_start,
  wb.week_end,
  p.id AS professional_id,
  p.name AS professional_name,
  COALESCE(sm.scheduled_minutes, 0) AS scheduled_minutes,
  COALESCE(bm.booked_minutes, 0) AS booked_minutes,
  COALESCE(bm.appointment_count, 0) AS appointment_count,
  CASE
    WHEN COALESCE(sm.scheduled_minutes, 0) = 0 THEN 0
    ELSE ROUND((COALESCE(bm.booked_minutes, 0)::NUMERIC / sm.scheduled_minutes::NUMERIC) * 100, 1)
  END AS occupancy_pct
FROM public.professionals p
CROSS JOIN week_bounds wb
LEFT JOIN schedule_minutes sm ON sm.professional_id = p.id
LEFT JOIN booked_minutes bm ON bm.professional_id = p.id
WHERE p.is_active = TRUE
  AND public.is_admin()
ORDER BY p.sort_order, p.name;

CREATE OR REPLACE VIEW public.v_admin_hourly_distribution
WITH (security_invoker = on) AS
WITH hours AS (
  SELECT generate_series(0, 23) AS hour_num
)
SELECT
  h.hour_num,
  LPAD(h.hour_num::TEXT, 2, '0') || ':00' AS hour_label,
  COALESCE(COUNT(a.id), 0)::INT AS total_appointments
FROM hours h
LEFT JOIN public.appointments a
  ON EXTRACT(HOUR FROM a.start_time) = h.hour_num
 AND a.appointment_date >= current_date - INTERVAL '59 days'
 AND a.status <> 'cancelled'
WHERE public.is_admin()
GROUP BY h.hour_num
ORDER BY h.hour_num;

CREATE OR REPLACE VIEW public.v_admin_status_mix
WITH (security_invoker = on) AS
SELECT
  status,
  COUNT(*)::INT AS total_appointments
FROM public.appointments
WHERE public.is_admin()
  AND appointment_date >= current_date - INTERVAL '29 days'
GROUP BY status
ORDER BY status;

GRANT SELECT ON public.v_client_loyalty_summary TO authenticated;
GRANT SELECT ON public.v_admin_daily_ops TO authenticated;
GRANT SELECT ON public.v_admin_professional_load TO authenticated;
GRANT SELECT ON public.v_admin_hourly_distribution TO authenticated;
GRANT SELECT ON public.v_admin_status_mix TO authenticated;
GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.reviews TO authenticated;
GRANT SELECT ON public.loyalty_points_ledger TO authenticated;

COMMIT;
