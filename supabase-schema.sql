-- =============================================================
-- VASCA LASHES — Administrador de Turnos
-- Schema para Supabase
-- =============================================================
-- Ejecutar en el SQL Editor de Supabase (https://supabase.com/dashboard)
-- =============================================================

-- ─── 1. EXTENSIONES ──────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 2. TABLA: professionals ─────────────────────────────────
-- Las profesionales del local (Fefi, Fer, etc.)
CREATE TABLE IF NOT EXISTS professionals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,           -- 'fefi', 'fer'
  avatar_url  TEXT,
  bio         TEXT,
  color       TEXT DEFAULT '#8f7769',         -- Color de marca para el calendario
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. TABLA: services ──────────────────────────────────────
-- Los servicios que ofrece Vasca
CREATE TABLE IF NOT EXISTS services (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT,
  duration_minutes    INT NOT NULL DEFAULT 60,
  category            TEXT DEFAULT 'general',   -- 'pestañas', 'cejas', 'combo'
  image_url           TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  sort_order          INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. TABLA: service_professional_prices ───────────────────
-- Precios por profesional y servicio (Fefi $18.000, Fer $22.000, etc.)
CREATE TABLE IF NOT EXISTS service_professional_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  price_ars       DECIMAL(12, 2) NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service_id, professional_id)
);

-- ─── 5. TABLA: weekly_schedule ───────────────────────────────
-- Horarios semanales de cada profesional
-- day_of_week: 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
CREATE TABLE IF NOT EXISTS weekly_schedule (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,        -- ej. '09:00'
  end_time        TIME NOT NULL,        -- ej. '18:00'
  break_start     TIME,                 -- ej. '13:00' (almuerzo)
  break_end       TIME,                 -- ej. '14:00'
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(professional_id, day_of_week)
);

-- ─── 6. TABLA: blocked_dates ─────────────────────────────────
-- Días bloqueados (feriados, vacaciones, días personales)
CREATE TABLE IF NOT EXISTS blocked_dates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  professional_id UUID REFERENCES professionals(id) ON DELETE CASCADE,  -- NULL = aplica a todas
  blocked_date    DATE NOT NULL,
  reason          TEXT,                  -- 'Feriado', 'Vacaciones', etc.
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. TABLA: clients ──────────────────────────────────────
-- Datos de las clientas
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT,
  instagram   TEXT,                     -- @usuario de Instagram
  notes       TEXT,                     -- Notas internas sobre la clienta
  total_visits INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 8. TABLA: appointments ─────────────────────────────────
-- Los turnos reservados
CREATE TABLE IF NOT EXISTS appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  
  -- Fecha y hora del turno
  appointment_date DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  
  -- Estado del turno
  status          TEXT NOT NULL DEFAULT 'pending' 
                  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  
  -- Precio al momento de la reserva (por si cambia después)
  price_ars       DECIMAL(12, 2) NOT NULL,
  
  -- Método de pago y estado
  payment_method  TEXT CHECK (payment_method IN ('cash', 'transfer', 'card', 'mercadopago', NULL)),
  payment_status  TEXT DEFAULT 'pending' 
                  CHECK (payment_status IN ('pending', 'partial', 'paid', 'refunded')),
  
  -- Notas
  client_notes    TEXT,                 -- Notas de la clienta al reservar
  internal_notes  TEXT,                 -- Notas internas del equipo
  
  -- Recordatorios
  reminder_sent   BOOLEAN DEFAULT FALSE,
  reminder_sent_at TIMESTAMPTZ,
  
  -- Timestamps
  confirmed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 9. TABLA: settings ─────────────────────────────────────
-- Configuración general del negocio
CREATE TABLE IF NOT EXISTS settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 10. TABLA: appointment_history ──────────────────────────
-- Historial de cambios de estado de los turnos (auditoría)
CREATE TABLE IF NOT EXISTS appointment_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  old_status      TEXT,
  new_status      TEXT NOT NULL,
  changed_by      TEXT,                 -- 'system', 'admin', 'client'
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================================
-- ÍNDICES
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_appointments_date 
  ON appointments(appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_professional 
  ON appointments(professional_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_client 
  ON appointments(client_id);

CREATE INDEX IF NOT EXISTS idx_appointments_status 
  ON appointments(status);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_date 
  ON blocked_dates(blocked_date);

CREATE INDEX IF NOT EXISTS idx_clients_phone 
  ON clients(phone);

CREATE INDEX IF NOT EXISTS idx_weekly_schedule_professional 
  ON weekly_schedule(professional_id, day_of_week);


-- =============================================================
-- FUNCIONES Y TRIGGERS
-- =============================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER trg_professionals_updated
  BEFORE UPDATE ON professionals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_services_updated
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_service_professional_prices_updated
  BEFORE UPDATE ON service_professional_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Función para registrar cambios de estado en appointments
CREATE OR REPLACE FUNCTION log_appointment_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO appointment_history (appointment_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, 'system');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointment_status_log
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_appointment_status_change();

-- Función para incrementar total_visits al completar un turno
CREATE OR REPLACE FUNCTION increment_client_visits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE clients SET total_visits = total_visits + 1 WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_visits
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION increment_client_visits();

-- Función para verificar que no haya turnos superpuestos
CREATE OR REPLACE FUNCTION check_appointment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE professional_id = NEW.professional_id
      AND appointment_date = NEW.appointment_date
      AND id != COALESCE(NEW.id, uuid_generate_v4())
      AND status NOT IN ('cancelled', 'no_show')
      AND (
        (NEW.start_time >= start_time AND NEW.start_time < end_time)
        OR (NEW.end_time > start_time AND NEW.end_time <= end_time)
        OR (NEW.start_time <= start_time AND NEW.end_time >= end_time)
      )
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno en ese horario para esta profesional';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_overlap
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_appointment_overlap();


-- =============================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_professional_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_history ENABLE ROW LEVEL SECURITY;

-- Policies: lectura pública para datos del sitio web
CREATE POLICY "Profesionales visibles públicamente"
  ON professionals FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Servicios visibles públicamente"
  ON services FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Precios visibles públicamente"
  ON service_professional_prices FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Horarios visibles públicamente"
  ON weekly_schedule FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Días bloqueados visibles públicamente"
  ON blocked_dates FOR SELECT
  USING (TRUE);

-- Policies: las clientas pueden crear sus propios registros
CREATE POLICY "Clientas pueden registrarse"
  ON clients FOR INSERT
  WITH CHECK (TRUE);

-- Policies: los turnos pueden crearse públicamente (reserva online)
CREATE POLICY "Crear turnos públicamente"
  ON appointments FOR INSERT
  WITH CHECK (TRUE);

-- Policies: admin acceso total (autenticados con rol service_role)
-- Nota: Estas policies son para el dashboard admin usando supabase-js con service_role key
CREATE POLICY "Admin acceso total profesionales"
  ON professionals FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total servicios"
  ON services FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total precios"
  ON service_professional_prices FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total horarios"
  ON weekly_schedule FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total bloqueados"
  ON blocked_dates FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total clientas"
  ON clients FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total turnos"
  ON appointments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total settings"
  ON settings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin acceso total historial"
  ON appointment_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- =============================================================
-- DATOS INICIALES (SEED)
-- =============================================================

-- Profesionales
INSERT INTO professionals (name, slug, color, sort_order) VALUES
  ('Fefi', 'fefi', '#c9a88e', 1),
  ('Fer',  'fer',  '#8f7769', 2)
ON CONFLICT (slug) DO NOTHING;

-- Servicios
INSERT INTO services (name, slug, description, duration_minutes, category, sort_order) VALUES
  ('Lifting de pestañas',    'lifting-pestanas',    'Eleva y curva la pestaña natural desde la raíz.',           60,  'pestañas', 1),
  ('Laminado y perfilado de cejas', 'laminado-cejas', 'Ordena y define la dirección del vello.',                70,  'cejas',    2),
  ('Perfilado de cejas',     'perfilado-cejas',     'Diseño según la forma natural del rostro.',                 30,  'cejas',    3),
  ('Combo básico',           'combo-basico',        'Lifting de pestañas + perfilado de cejas. Mirada más abierta y definida.', 90, 'combo', 4),
  ('Combo completo',         'combo-completo',      'Lifting + laminado + perfilado. Transformación completa de la mirada.', 110, 'combo', 5),
  ('Nutrición y tinte',      'nutricion-tinte',     'Fortalece y aporta definición.',                           40,  'general',  6)
ON CONFLICT (slug) DO NOTHING;

-- Precios por profesional
-- Usamos subqueries para obtener los IDs dinámicamente
INSERT INTO service_professional_prices (service_id, professional_id, price_ars)
SELECT s.id, p.id, prices.price
FROM (VALUES
  ('lifting-pestanas',    'fefi', 18000),
  ('lifting-pestanas',    'fer',  22000),
  ('laminado-cejas',      'fefi', 16000),
  ('laminado-cejas',      'fer',  20000),
  ('perfilado-cejas',     'fefi', 8000),
  ('perfilado-cejas',     'fer',  10000),
  ('combo-basico',        'fefi', 22000),
  ('combo-basico',        'fer',  26000),
  ('combo-completo',      'fefi', 28000),
  ('combo-completo',      'fer',  34000),
  ('nutricion-tinte',     'fefi', 10000),
  ('nutricion-tinte',     'fer',  12000)
) AS prices(service_slug, professional_slug, price)
JOIN services s ON s.slug = prices.service_slug
JOIN professionals p ON p.slug = prices.professional_slug
ON CONFLICT (service_id, professional_id) DO NOTHING;

-- Horarios semanales (Lunes a Viernes, 9:00 a 18:00)
INSERT INTO weekly_schedule (professional_id, day_of_week, start_time, end_time, break_start, break_end)
SELECT p.id, d.day, '09:00'::TIME, '18:00'::TIME, '13:00'::TIME, '14:00'::TIME
FROM professionals p
CROSS JOIN (VALUES (1), (2), (3), (4), (5)) AS d(day)
ON CONFLICT (professional_id, day_of_week) DO NOTHING;

-- Configuración inicial
INSERT INTO settings (key, value, description) VALUES
  ('business_name',   '"Vasca | Lashes & Eyebrows"',  'Nombre del negocio'),
  ('business_address', '"Alvarado 968"',               'Dirección'),
  ('business_hours',   '{"weekdays": "Lunes a Viernes", "start": "09:00", "end": "18:00"}', 'Horario de atención'),
  ('booking_rules',    '{"min_advance_hours": 2, "max_advance_days": 30, "cancellation_hours": 4}', 'Reglas de reserva'),
  ('slot_interval',    '30',                           'Intervalo de slots en minutos'),
  ('instagram',        '"https://www.instagram.com/vasca.lashes/"', 'Instagram del negocio')
ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- VISTA: turnos del día con info completa
-- =============================================================
CREATE OR REPLACE VIEW v_daily_appointments AS
SELECT 
  a.id,
  a.appointment_date,
  a.start_time,
  a.end_time,
  a.status,
  a.price_ars,
  a.payment_status,
  a.client_notes,
  a.internal_notes,
  c.full_name   AS client_name,
  c.phone       AS client_phone,
  c.instagram   AS client_instagram,
  c.total_visits AS client_total_visits,
  p.name        AS professional_name,
  p.slug        AS professional_slug,
  p.color       AS professional_color,
  s.name        AS service_name,
  s.duration_minutes,
  s.category    AS service_category
FROM appointments a
JOIN clients c ON c.id = a.client_id
JOIN professionals p ON p.id = a.professional_id
JOIN services s ON s.id = a.service_id
ORDER BY a.appointment_date, a.start_time;


-- =============================================================
-- VISTA: disponibilidad por profesional
-- =============================================================
CREATE OR REPLACE VIEW v_professional_availability AS
SELECT
  p.id AS professional_id,
  p.name AS professional_name,
  ws.day_of_week,
  ws.start_time,
  ws.end_time,
  ws.break_start,
  ws.break_end,
  ws.is_active
FROM professionals p
JOIN weekly_schedule ws ON ws.professional_id = p.id
WHERE p.is_active = TRUE
ORDER BY p.sort_order, ws.day_of_week;
