CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  belt VARCHAR(20) DEFAULT 'white',
  role VARCHAR(20) DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id),
    belt VARCHAR(20) DEFAULT 'white',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de técnicas (modificada)
CREATE TABLE techniques (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  belt_level VARCHAR(20) DEFAULT 'white',
  level VARCHAR(20) DEFAULT 'beginner',
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Esta línea debe estar presente
);

-- Tabla para videos de técnicas
CREATE TABLE technique_videos (
  id SERIAL PRIMARY KEY,
  technique_id INTEGER REFERENCES techniques(id) ON DELETE CASCADE,
  video_url VARCHAR(255) NOT NULL,
  video_type VARCHAR(20) DEFAULT 'youtube', -- youtube, tiktok, instagram
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de sesiones de entrenamiento
CREATE TABLE training_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  techniques TEXT[], -- Array de técnicas trabajadas
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de comentarios
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  training_session_id INTEGER REFERENCES training_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- Tablas para Game Plans
CREATE TABLE gameplans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  position VARCHAR(50) DEFAULT 'guard',
  is_public BOOLEAN DEFAULT false,
  is_suggested BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gameplan_nodes (
  id SERIAL PRIMARY KEY,
  gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
  technique_id VARCHAR(50), -- Puede ser ID de técnica o condición personalizada
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL, -- technique, condition
  x INTEGER DEFAULT 0,
  y INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gameplan_connections (
  id SERIAL PRIMARY KEY,
  gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
  from_node INTEGER NOT NULL,  -- ← DEBE ser INTEGER
  to_node INTEGER NOT NULL,    -- ← DEBE ser INTEGER
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_techniques_approved ON techniques(approved);
CREATE INDEX idx_techniques_type ON techniques(type);
CREATE INDEX idx_techniques_belt_level ON techniques(belt_level);
CREATE INDEX idx_training_sessions_user_id ON training_sessions(user_id);
CREATE INDEX idx_training_sessions_date ON training_sessions(date);
CREATE INDEX idx_gameplans_user_id ON gameplans(user_id);
CREATE INDEX idx_gameplans_is_public ON gameplans(is_public);
CREATE INDEX idx_gameplans_is_suggested ON gameplans(is_suggested);
CREATE INDEX idx_gameplan_nodes_gameplan_id ON gameplan_nodes(gameplan_id);
CREATE INDEX idx_gameplan_connections_gameplan_id ON gameplan_connections(gameplan_id);

-- Tabla para favoritos de game plans
CREATE TABLE gameplan_favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, gameplan_id)
);

-- Tabla para game plans compartidos
CREATE TABLE gameplan_shares (
    id SERIAL PRIMARY KEY,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    from_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gameplan_id, to_user_id)
);

-- Insertar datos iniciales de técnicas
INSERT INTO techniques (name, type, belt_level, level, description, approved) VALUES
('Omoplata', 'submission', 'blue', 'intermediate', 'Sumisión de hombro desde guardia', true),
('Armbar', 'submission', 'white', 'beginner', 'Llave de brazo desde montada', true),
('Triangle', 'submission', 'blue', 'intermediate', 'Triángulo con las piernas', true),
('De La Riva', 'guard', 'blue', 'intermediate', 'Guardia con pierna enganchada', true);

-- Insertar usuario admin por defecto con contraseña válida (admin123)
INSERT INTO users (name, email, password, belt, role) VALUES
('Admin User', 'admin@bjj.com', '$2a$10$rOzZJb7UKbBQK1a0w1qgE.A6q9q9q9q9q9q9q9q9q9q9q9q9q9q9q', 'black', 'master');

-- Tabla para comentarios en game plans
CREATE TABLE gameplan_comments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para seguimiento de técnicas vistas por usuarios
CREATE TABLE user_technique_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  technique_id INTEGER REFERENCES techniques(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, technique_id)
);

-- Tabla para likes en comentarios
CREATE TABLE comment_likes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES gameplan_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, comment_id)
);

-- Tabla para control de permisos en comentarios
CREATE TABLE comment_permissions (
    id SERIAL PRIMARY KEY,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    can_comment BOOLEAN DEFAULT true,
    can_delete BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gameplan_id, user_id)
);

CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Índices para mejorar rendimiento
CREATE INDEX idx_gameplan_comments_gameplan_id ON gameplan_comments(gameplan_id);
CREATE INDEX idx_user_technique_views_user_id ON user_technique_views(user_id);
CREATE INDEX idx_user_technique_views_technique_id ON user_technique_views(technique_id);

CREATE UNIQUE INDEX idx_gameplan_comments_unique 
ON gameplan_comments (gameplan_id, user_id, content, created_at);

-- Tabla para notificaciones
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  is_read BOOLEAN DEFAULT false,
  related_id INTEGER, -- ID del game plan, técnica, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- Tabla para eventos
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  date TIMESTAMP NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'general',
  description TEXT,
  torneo_data JSONB,
  created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para horarios de entrenamiento
CREATE TABLE training_schedule (
  id SERIAL PRIMARY KEY,
  day VARCHAR(20) NOT NULL,
  time VARCHAR(50) NOT NULL,
  class VARCHAR(100) NOT NULL,
  level VARCHAR(50) NOT NULL,
  day_order INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar horarios por defecto
INSERT INTO training_schedule (day, time, class, level, day_order) VALUES
('Lunes', '19:00 - 20:30', 'BJJ Fundamental', 'Todos', 1),
('Martes', '19:00 - 20:30', 'BJJ Avanzado', 'Azul+', 2),
('Miércoles', '19:00 - 20:30', 'No-Gi', 'Todos', 3),
('Jueves', '19:00 - 20:30', 'BJJ Competição', 'Intermedio+', 4),
('Viernes', '18:00 - 19:30', 'Open Mat', 'Todos', 5),
('Sábado', '10:00 - 12:00', 'BJJ & Drills', 'Todos', 6);

-- Índices para mejorar rendimiento
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_training_schedule_day_order ON training_schedule(day_order);

-- Tabla para perfiles de usuario extendidos
CREATE TABLE user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nickname VARCHAR(50),
    profile_picture TEXT,
    academy VARCHAR(100) DEFAULT 'JIUJITSU CLUBE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Tabla para objetivos personales
CREATE TABLE user_objectives (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    deadline DATE,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para preferencias de usuario
CREATE TABLE user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(20) DEFAULT 'auto',
    notifications_enabled BOOLEAN DEFAULT true,
    language VARCHAR(10) DEFAULT 'es',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Tabla para seguimiento de actividad de alumnos
CREATE TABLE student_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_count INTEGER DEFAULT 0,
    last_session_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    objectives JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Trigger para actualizar student_activity cuando se crea una sesión
CREATE OR REPLACE FUNCTION update_student_activity()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO student_activity (user_id, session_count, last_session_date, updated_at)
    VALUES (NEW.user_id, 1, NEW.date, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        session_count = student_activity.session_count + 1,
        last_session_date = NEW.date,
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_training_session_insert
    AFTER INSERT ON training_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_student_activity();

-- Índices para mejorar rendimiento
CREATE INDEX idx_student_activity_user_id ON student_activity(user_id);
CREATE INDEX idx_student_activity_last_session ON student_activity(last_session_date);

-- ==============================================
-- 1. TABLA DE PLANES (catálogo)
-- ==============================================
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE, -- 'free', 'pro', 'club'
    max_students INTEGER NOT NULL,
    max_instructors INTEGER NOT NULL,
    can_export_reports BOOLEAN DEFAULT FALSE,
    can_use_advanced_stats BOOLEAN DEFAULT FALSE,
    can_send_bulk_messages BOOLEAN DEFAULT FALSE,
    has_payment_system BOOLEAN DEFAULT FALSE,
    has_api BOOLEAN DEFAULT FALSE,
    price_monthly DECIMAL(10,2) NOT NULL,
    price_yearly DECIMAL(10,2),
    features JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar los planes
INSERT INTO plans (name, code, max_students, max_instructors, can_export_reports, can_use_advanced_stats, can_send_bulk_messages, has_payment_system, has_api, price_monthly) VALUES
('Gratuito', 'free', 20, 1, FALSE, FALSE, FALSE, FALSE, FALSE, 0),
('Pro', 'pro', 100, 3, TRUE, TRUE, TRUE, TRUE, FALSE, 9.99),
('Club', 'club', 999999, 999999, TRUE, TRUE, TRUE, TRUE, TRUE, 29.99);

-- ==============================================
-- 2. TABLA DE SUSCRIPCIONES DE CLUBES
-- ==============================================
CREATE TABLE IF NOT EXISTS club_subscriptions (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'expired', 'cancelled', 'trial'
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP,
    auto_renew BOOLEAN DEFAULT TRUE,
    payment_method VARCHAR(50),
    payment_details JSONB,
    trial_ends_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, status) -- Solo una suscripción activa por club
);

-- ==============================================
-- 3. MODIFICAR TABLA CLUBS (agregar columnas)
-- ==============================================
ALTER TABLE clubs 
ADD COLUMN IF NOT EXISTS current_plan_id INTEGER REFERENCES plans(id),
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS total_students INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_instructors INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS plan_history JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);

-- ==============================================
-- 4. TABLA DE PAGOS
-- ==============================================
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES club_subscriptions(id),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
    payment_method VARCHAR(50),
    transaction_id VARCHAR(100),
    invoice_url TEXT,
    period_start DATE,
    period_end DATE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 5. TABLA DE INVITACIONES PARA INSTRUCTORES
-- ==============================================
CREATE TABLE IF NOT EXISTS instructor_invitations (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    email VARCHAR(100) NOT NULL,
    token VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(20) DEFAULT 'instructor',
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 6. TABLA DE ASISTENCIA QR
-- ==============================================
CREATE TABLE IF NOT EXISTS attendance_qr_codes (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    qr_code VARCHAR(255) UNIQUE NOT NULL,
    qr_image TEXT, -- Base64 o URL de la imagen
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES training_schedule(id),
    scanned_by INTEGER REFERENCES users(id),
    scan_method VARCHAR(20) DEFAULT 'qr', -- 'qr', 'manual', 'import'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 7. TABLA DE ESTADÍSTICAS (cache para KPIs)
-- ==============================================
CREATE TABLE IF NOT EXISTS club_stats_cache (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    stats_type VARCHAR(50) NOT NULL, -- 'retention', 'attendance', 'payments', etc
    stats_data JSONB NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, stats_type, period_start, period_end)
);

-- ==============================================
-- 8. TABLA DE EXAMENES
-- ==============================================
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    current_belt VARCHAR(20) NOT NULL,
    target_belt VARCHAR(20) NOT NULL,
    exam_date TIMESTAMP NOT NULL,
    techniques JSONB DEFAULT '[]'::jsonb,
    requirements JSONB DEFAULT '{}'::jsonb,
    result VARCHAR(20) DEFAULT 'pending', -- 'pending', 'passed', 'failed'
    evaluator_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- 9. AGREGAR COLUMNAS A TABLAS EXISTENTES
-- ==============================================

-- Agregar columnas a students
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS qr_code_id INTEGER REFERENCES attendance_qr_codes(id),
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS next_payment_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS current_plan VARCHAR(20) DEFAULT 'monthly',
ADD COLUMN IF NOT EXISTS medical_info JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS emergency_contact JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS attendance_rate DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_attendance TIMESTAMP;

-- Agregar columnas a training_sessions
ALTER TABLE training_sessions 
ADD COLUMN IF NOT EXISTS attendance_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES training_schedule(id),
ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES users(id),
ADD COLUMN IF NOT EXISTS techniques_practiced JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS intensity_level INTEGER CHECK (intensity_level BETWEEN 1 AND 10),
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

-- ==============================================
-- 10. ÍNDICES PARA OPTIMIZACIÓN
-- ==============================================
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_club_id ON club_subscriptions(club_id);
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_status ON club_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payments_club_id ON payments(club_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_id ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_created_at ON attendance_records(created_at);
CREATE INDEX IF NOT EXISTS idx_exams_student_id ON exams(student_id);
CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date);
CREATE INDEX IF NOT EXISTS idx_students_payment_status ON students(payment_status);
CREATE INDEX IF NOT EXISTS idx_students_next_payment_date ON students(next_payment_date);

-- ==============================================
-- 11. FUNCIÓN PARA ACTUALIZAR ESTADÍSTICAS
-- ==============================================
CREATE OR REPLACE FUNCTION update_club_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar total de alumnos en el club
    UPDATE clubs 
    SET total_students = (
        SELECT COUNT(*) FROM students WHERE club_id = NEW.club_id
    )
    WHERE id = NEW.club_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER trigger_update_club_stats
AFTER INSERT OR DELETE ON students
FOR EACH ROW
EXECUTE FUNCTION update_club_stats();

-- ==============================================
-- 12. DATOS INICIALES PARA PRUEBAS
-- ==============================================
-- Asignar plan free a clubs existentes
UPDATE clubs 
SET current_plan_id = (SELECT id FROM plans WHERE code = 'free'),
    subscription_status = 'active',
    subscription_start_date = CURRENT_TIMESTAMP,
    subscription_end_date = CURRENT_TIMESTAMP + INTERVAL '1 month'
WHERE current_plan_id IS NULL;
-- ==============================================
-- SISTEMA DE NOTIFICACIONES Y COMPROBANTES
-- ==============================================

-- 1. TABLA DE CONFIGURACIÓN DE NOTIFICACIONES POR CLUB
CREATE TABLE IF NOT EXISTS notification_settings (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    reminder_days INTEGER[] DEFAULT '{7,3,1}', -- Días antes para recordar
    reminder_enabled BOOLEAN DEFAULT true,
    reminder_time TIME DEFAULT '09:00:00', -- Hora del día para enviar
    email_enabled BOOLEAN DEFAULT true,
    whatsapp_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id)
);

-- 2. TABLA DE NOTIFICACIONES PROGRAMADAS
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'reminder', 'expired', 'payment_confirmation'
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    scheduled_for TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    related_id INTEGER, -- ID del pago, membresía, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. TABLA DE COMPROBANTES DE PAGO
CREATE TABLE IF NOT EXISTS payment_receipts (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    pdf_url TEXT,
    pdf_data TEXT, -- Base64 del PDF para guardar
    sent_email BOOLEAN DEFAULT false,
    sent_whatsapp BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMP,
    whatsapp_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABLA DE HISTORIAL DE MEMBRESÍAS (para tracking)
CREATE TABLE IF NOT EXISTS membership_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    membership_plan_id INTEGER REFERENCES membership_plans(id),
    status VARCHAR(20) NOT NULL, -- 'active', 'expired', 'cancelled'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    payment_id INTEGER REFERENCES payments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. FUNCIÓN PARA GENERAR NÚMERO DE RECIBO
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    seq_number INTEGER;
    club_prefix VARCHAR(10);
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    
    -- Obtener prefijo del club
    SELECT substring(regexp_replace(lower(c.name), '[^a-z]', '', 'g'), 1, 3) 
    INTO club_prefix
    FROM clubs c WHERE c.id = NEW.club_id;
    
    -- Obtener siguiente número de secuencia
    SELECT COALESCE(MAX(CAST(substring(receipt_number from '\d+$') AS INTEGER)), 0) + 1
    INTO seq_number
    FROM payment_receipts 
    WHERE club_id = NEW.club_id AND receipt_number LIKE club_prefix || '-' || year_prefix || '-%';
    
    NEW.receipt_number := club_prefix || '-' || year_prefix || '-' || LPAD(seq_number::TEXT, 6, '0');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para generar número de recibo automáticamente
CREATE TRIGGER trigger_generate_receipt_number
    BEFORE INSERT ON payment_receipts
    FOR EACH ROW
    EXECUTE FUNCTION generate_receipt_number();

-- 6. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user ON scheduled_notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_date ON scheduled_notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_user ON payment_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment ON payment_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_membership_history_user ON membership_history(user_id);
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'clubs'
ORDER BY ordinal_position;
-- Agregar columnas a clubs (opcional)
ALTER TABLE clubs 
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS email VARCHAR(100),
ADD COLUMN IF NOT EXISTS logo_url TEXT;
-- Agregar columnas a clubs
ALTER TABLE clubs 
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS email VARCHAR(100),
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Agregar columnas faltantes a users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
-- Crear tabla de comprobantes de pago
CREATE TABLE IF NOT EXISTS payment_receipts (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    receipt_number VARCHAR(50) UNIQUE,
    pdf_data TEXT,
    sent_email BOOLEAN DEFAULT false,
    sent_whatsapp BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMP,
    whatsapp_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment ON payment_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_user ON payment_receipts(user_id);
-- Función para generar número de recibo
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    seq_number INTEGER;
    club_prefix VARCHAR(10);
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    
    -- Obtener prefijo del club (primeras 3 letras del nombre)
    SELECT substring(regexp_replace(lower(c.name), '[^a-z]', '', 'g'), 1, 3) 
    INTO club_prefix
    FROM clubs c WHERE c.id = NEW.club_id;
    
    -- Si no hay club_prefix, usar 'CLB'
    IF club_prefix IS NULL OR club_prefix = '' THEN
        club_prefix := 'CLB';
    END IF;
    
    -- Obtener siguiente número de secuencia
    SELECT COALESCE(MAX(CAST(substring(receipt_number from '\d+$') AS INTEGER)), 0) + 1
    INTO seq_number
    FROM payment_receipts 
    WHERE club_id = NEW.club_id AND receipt_number LIKE club_prefix || '-' || year_prefix || '-%';
    
    NEW.receipt_number := UPPER(club_prefix) || '-' || year_prefix || '-' || LPAD(seq_number::TEXT, 6, '0');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para generar número de recibo automáticamente
DROP TRIGGER IF EXISTS trigger_generate_receipt_number ON payment_receipts;
CREATE TRIGGER trigger_generate_receipt_number
    BEFORE INSERT ON payment_receipts
    FOR EACH ROW
    EXECUTE FUNCTION generate_receipt_number();
    -- Verificar estructura de clubs
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'clubs'
ORDER BY ordinal_position;

-- Verificar estructura de users
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Verificar que payment_receipts se creó correctamente
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'payment_receipts'
ORDER BY ordinal_position;
-- ==============================================
-- SISTEMA DE COMPETENCIAS
-- ==============================================

-- 1. TABLA DE COMPETENCIAS
CREATE TABLE IF NOT EXISTS competitions (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    event_date DATE NOT NULL,
    location VARCHAR(200),
    organizer VARCHAR(100),
    website VARCHAR(200),
    registration_deadline DATE,
    registration_fee DECIMAL(10,2),
    category VARCHAR(50), -- 'local', 'regional', 'nacional', 'internacional'
    status VARCHAR(20) DEFAULT 'upcoming', -- 'upcoming', 'ongoing', 'completed', 'cancelled'
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABLA DE PARTICIPANTES EN COMPETENCIAS
CREATE TABLE IF NOT EXISTS competition_participants (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    category_weight VARCHAR(50),
    category_age VARCHAR(50),
    belt_division VARCHAR(20),
    result VARCHAR(20), -- 'oro', 'plata', 'bronce', 'participacion', 'no_presento'
    fight_count INTEGER DEFAULT 0,
    win_count INTEGER DEFAULT 0,
    loss_count INTEGER DEFAULT 0,
    observations TEXT,
    registered_by INTEGER REFERENCES users(id),
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(competition_id, user_id)
);

-- 3. TABLA DE GASTOS DE COMPETENCIAS
CREATE TABLE IF NOT EXISTS competition_expenses (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    concept VARCHAR(200) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    paid_by INTEGER REFERENCES users(id),
    receipt_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABLA DE FOTOS DE COMPETENCIAS
CREATE TABLE IF NOT EXISTS competition_photos (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    caption VARCHAR(500),
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_competitions_club ON competitions(club_id);
CREATE INDEX IF NOT EXISTS idx_competitions_date ON competitions(event_date);
CREATE INDEX IF NOT EXISTS idx_competition_participants ON competition_participants(competition_id, user_id);
CREATE INDEX IF NOT EXISTS idx_competition_expenses ON competition_expenses(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_photos ON competition_photos(competition_id);
-- Agregar columnas a competition_participants
ALTER TABLE competition_participants 
ADD COLUMN IF NOT EXISTS belt_at_competition VARCHAR(20),
ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
ADD COLUMN IF NOT EXISTS gi_mode VARCHAR(10), -- 'gi', 'no-gi'
ADD COLUMN IF NOT EXISTS age_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS weight_category VARCHAR(50);

-- ==============================================
-- SISTEMA DE PROMOCIONES (GRADUACIONES)
-- ==============================================

-- 1. TABLA DE PROMOCIONES
CREATE TABLE IF NOT EXISTS promotions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    old_belt VARCHAR(20) NOT NULL,
    new_belt VARCHAR(20) NOT NULL,
    promotion_date DATE NOT NULL,
    granted_by INTEGER REFERENCES users(id),
    time_in_old_belt INTERVAL, -- Tiempo que estuvo en el cinturón anterior
    sessions_in_old_belt INTEGER, -- Cantidad de sesiones mientras tenía ese cinturón
    observations TEXT,
    certificate_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_promotions_user ON promotions(user_id);
CREATE INDEX IF NOT EXISTS idx_promotions_club ON promotions(club_id);
CREATE INDEX IF NOT EXISTS idx_promotions_date ON promotions(promotion_date);

-- 3. TABLA DE PARÁMETROS DE PROMOCIÓN (para sugerencias)
CREATE TABLE IF NOT EXISTS promotion_parameters (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    belt_from VARCHAR(20) NOT NULL,
    belt_to VARCHAR(20) NOT NULL,
    min_months INTEGER, -- Tiempo mínimo recomendado en meses
    min_sessions INTEGER, -- Sesiones mínimas recomendadas
    UNIQUE(club_id, belt_from, belt_to)
);

-- 4. DATOS POR DEFECTO (basados en estándares)
INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'white', 'blue', 12, 150
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'white' AND belt_to = 'blue');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'blue', 'purple', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'blue' AND belt_to = 'purple');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'purple', 'brown', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'purple' AND belt_to = 'brown');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'brown', 'black', 18, 250
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'brown' AND belt_to = 'black');
-- Verificar si la tabla existe y tiene datos
SELECT * FROM promotion_parameters WHERE club_id = 1;

-- Si no hay datos, insertar los valores por defecto
INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'white', 'blue', 12, 150
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'white' AND belt_to = 'blue');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'blue', 'purple', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'blue' AND belt_to = 'purple');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'purple', 'brown', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'purple' AND belt_to = 'brown');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'brown', 'black', 18, 250
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'brown' AND belt_to = 'black');
-- Verificar si la tabla existe
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_name = 'promotion_parameters'
);

-- Si no existe, crearla
CREATE TABLE IF NOT EXISTS promotion_parameters (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    belt_from VARCHAR(20) NOT NULL,
    belt_to VARCHAR(20) NOT NULL,
    min_months INTEGER,
    min_sessions INTEGER,
    UNIQUE(club_id, belt_from, belt_to)
);

-- Insertar valores por defecto si no existen
INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'white', 'blue', 12, 150
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'white' AND belt_to = 'blue');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'blue', 'purple', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'blue' AND belt_to = 'purple');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'purple', 'brown', 18, 200
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'purple' AND belt_to = 'brown');

INSERT INTO promotion_parameters (club_id, belt_from, belt_to, min_months, min_sessions)
SELECT 1, 'brown', 'black', 18, 250
WHERE NOT EXISTS (SELECT 1 FROM promotion_parameters WHERE belt_from = 'brown' AND belt_to = 'black');

-- Verificar los datos insertados
SELECT * FROM promotion_parameters;
-- ==============================================
-- SISTEMA DE PLANIFICACIÓN DE CLASES
-- ==============================================

-- 1. TABLA DE PLANIFICACIÓN DE CLASES
CREATE TABLE IF NOT EXISTS class_plans (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    class_date DATE NOT NULL,
    class_type VARCHAR(50) NOT NULL, -- 'fundamental', 'avanzado', 'no-gi', 'competicion'
    theme VARCHAR(100),
    techniques JSONB DEFAULT '[]'::jsonb, -- Array de técnicas
    drills TEXT,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, class_date, class_type)
);

-- 2. TABLA DE PROGRESIÓN CURRICULAR (plantillas por nivel)
CREATE TABLE IF NOT EXISTS curriculum_templates (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    belt_level VARCHAR(20) NOT NULL, -- 'white', 'blue', 'purple', 'brown', 'black'
    week_number INTEGER NOT NULL,
    theme VARCHAR(100) NOT NULL,
    suggested_techniques JSONB DEFAULT '[]'::jsonb,
    drills TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, belt_level, week_number)
);

-- 3. TABLA DE HISTORIAL DE ENSEÑANZA
CREATE TABLE IF NOT EXISTS teaching_history (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    technique_id VARCHAR(50) NOT NULL, -- ID de la técnica desde la base interna
    technique_name VARCHAR(100),
    times_taught INTEGER DEFAULT 0,
    last_taught DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, technique_id)
);

-- 4. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_class_plans_date ON class_plans(class_date);
CREATE INDEX IF NOT EXISTS idx_class_plans_club ON class_plans(club_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_belt ON curriculum_templates(belt_level);
CREATE INDEX IF NOT EXISTS idx_teaching_history_technique ON teaching_history(technique_id);
-- Agregar columna club_id a training_schedule
ALTER TABLE training_schedule 
ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE;

-- Actualizar registros existentes con club_id = 1 (club por defecto)
UPDATE training_schedule SET club_id = 1 WHERE club_id IS NULL;

-- Hacer que club_id sea NOT NULL después de actualizar
ALTER TABLE training_schedule 
ALTER COLUMN club_id SET NOT NULL;

-- Crear índice para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_training_schedule_club ON training_schedule(club_id);
-- ==============================================
-- TABLA DE NOTAS DEL MESTRE
-- ==============================================
CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    master_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_notes_student ON notes(student_id);
CREATE INDEX IF NOT EXISTS idx_notes_master ON notes(master_id);
-- 2. TABLA DE SUSCRIPCIONES DE CLUBES
CREATE TABLE IF NOT EXISTS club_subscriptions (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'active', 'expired', 'cancelled'
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    payment_method VARCHAR(50),
    payment_details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. AGREGAR CAMPOS A CLUBS
ALTER TABLE clubs 
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS current_plan_id INTEGER REFERENCES plans(id),
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;

-- 4. TABLA DE AUTORIZACIONES DE ALUMNOS
CREATE TABLE IF NOT EXISTS student_authorizations (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    authorized_by INTEGER REFERENCES users(id),
    authorized_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, club_id)
);

-- 5. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_club ON club_subscriptions(club_id);
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_status ON club_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_student_authorizations_student ON student_authorizations(student_id);
CREATE INDEX IF NOT EXISTS idx_student_authorizations_club ON student_authorizations(club_id);
CREATE INDEX IF NOT EXISTS idx_student_authorizations_status ON student_authorizations(status);
-- Crear índice
CREATE INDEX IF NOT EXISTS idx_club_subscriptions_club ON club_subscriptions(club_id);
-- ==============================================
-- SISTEMA DE PROGRAMACIÓN DE CAMBIOS DE PLAN
-- ==============================================

-- 1. Agregar columna para fecha de término a clubs
ALTER TABLE clubs 
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS pending_plan_id INTEGER REFERENCES plans(id),
ADD COLUMN IF NOT EXISTS pending_plan_start_date TIMESTAMP;

-- 2. Crear tabla de cambios programados
CREATE TABLE IF NOT EXISTS scheduled_plan_changes (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    current_plan_id INTEGER REFERENCES plans(id),
    new_plan_id INTEGER REFERENCES plans(id),
    effective_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'applied', 'cancelled'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_scheduled_changes_club ON scheduled_plan_changes(club_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_changes_status ON scheduled_plan_changes(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_changes_effective ON scheduled_plan_changes(effective_date);
-- ==============================================
-- SISTEMA DE AUTORIZACIÓN DE ALUMNOS
-- ==============================================

-- 1. Agregar columna de autorización a users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS requested_club_id INTEGER REFERENCES clubs(id),
ADD COLUMN IF NOT EXISTS request_message TEXT;

-- 2. Tabla de solicitudes de unión
CREATE TABLE IF NOT EXISTS membership_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_date TIMESTAMP,
    responded_by INTEGER REFERENCES users(id),
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_membership_requests_user ON membership_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_requests_club ON membership_requests(club_id);
CREATE INDEX IF NOT EXISTS idx_membership_requests_status ON membership_requests(status);
-- Agregar columna owner_id a clubs
ALTER TABLE clubs ADD COLUMN owner_id INTEGER REFERENCES users(id);

-- También agregar índice para mejor rendimiento
CREATE INDEX idx_clubs_owner_id ON clubs(owner_id);
-- Verificar si existe la tabla plans
SELECT * FROM plans;

-- Si no existe, crearla
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    max_students INTEGER DEFAULT 20,
    max_instructors INTEGER DEFAULT 1,
    can_export_reports BOOLEAN DEFAULT false,
    can_use_advanced_stats BOOLEAN DEFAULT false,
    can_send_bulk_messages BOOLEAN DEFAULT false,
    has_payment_system BOOLEAN DEFAULT false,
    has_api BOOLEAN DEFAULT false,
    price_monthly DECIMAL(10,2) DEFAULT 0,
    price_yearly DECIMAL(10,2) DEFAULT 0,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar plan gratuito si no existe
INSERT INTO plans (name, code, max_students, max_instructors, price_monthly, is_active)
SELECT 'Gratuito', 'free', 20, 1, 0, true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = 'free');

-- Agregar club_id a tablas que lo necesitan
ALTER TABLE techniques ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE gameplans ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE class_plans ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE academy_settings ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE training_schedule ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);

-- Crear índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_techniques_club_id ON techniques(club_id);
CREATE INDEX IF NOT EXISTS idx_gameplans_club_id ON gameplans(club_id);
CREATE INDEX IF NOT EXISTS idx_events_club_id ON events(club_id);
CREATE INDEX IF NOT EXISTS idx_class_plans_club_id ON class_plans(club_id);
CREATE INDEX IF NOT EXISTS idx_competitions_club_id ON competitions(club_id);
CREATE INDEX IF NOT EXISTS idx_membership_plans_club_id ON membership_plans(club_id);

-- Tabla de preferencias de pago
CREATE TABLE IF NOT EXISTS payment_preferences (
    id SERIAL PRIMARY KEY,
    preference_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    club_id INTEGER REFERENCES clubs(id),
    plan_id INTEGER REFERENCES plans(id),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    payment_id VARCHAR(100),
    payment_data JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_payment_preferences_preference_id ON payment_preferences(preference_id);
CREATE INDEX IF NOT EXISTS idx_payment_preferences_user_id ON payment_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_preferences_club_id ON payment_preferences(club_id);

-- Tabla de pagos (si no existe)
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id),
    user_id INTEGER REFERENCES users(id),
    plan_id INTEGER REFERENCES plans(id),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    payment_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    period_start TIMESTAMP,
    period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de preferencias de pago
CREATE TABLE IF NOT EXISTS payment_preferences (
    id SERIAL PRIMARY KEY,
    preference_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    club_id INTEGER REFERENCES clubs(id),
    plan_id INTEGER REFERENCES plans(id),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    payment_id VARCHAR(100),
    payment_data JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_payment_preferences_preference_id ON payment_preferences(preference_id);
CREATE INDEX IF NOT EXISTS idx_payment_preferences_user_id ON payment_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_preferences_club_id ON payment_preferences(club_id);

-- Crear tabla de pagos si no existe
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id),
    user_id INTEGER REFERENCES users(id),
    plan_id INTEGER REFERENCES plans(id),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    payment_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    period_start TIMESTAMP,
    period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de preferencias de pago
CREATE TABLE IF NOT EXISTS payment_preferences (
    id SERIAL PRIMARY KEY,
    preference_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    club_id INTEGER REFERENCES clubs(id),
    plan_id INTEGER REFERENCES plans(id),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    payment_id VARCHAR(100),
    payment_data JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de suscripciones
CREATE TABLE IF NOT EXISTS club_subscriptions (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) UNIQUE,
    plan_id INTEGER REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'active',
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    auto_renew BOOLEAN DEFAULT true,
    payment_method VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agregar todas las columnas que puedan faltar
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Actualizar registros existentes
UPDATE notifications SET is_read = false WHERE is_read IS NULL;
UPDATE notifications SET status = 'pending' WHERE status IS NULL;
UPDATE notifications SET scheduled_for = created_at WHERE scheduled_for IS NULL;
UPDATE notifications SET updated_at = created_at WHERE updated_at IS NULL;

-- Verificar estructura final
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'notifications'
ORDER BY ordinal_position;

-- Actualizar precios de planes (ajusta según tus valores reales)
-- Plan Gratuito (se mantiene en 0)
UPDATE plans SET price_monthly = 0, price_yearly = 0 WHERE code = 'free';

-- Plan Pro (ajusta estos valores)
UPDATE plans SET 
    price_monthly = 15000,  -- $15.000 ARS mensual
    price_yearly = 150000   -- $150.000 ARS anual (10% descuento)
WHERE code = 'pro';

-- Plan Club (ajusta estos valores)
UPDATE plans SET 
    price_monthly = 25000,  -- $25.000 ARS mensual
    price_yearly = 250000   -- $250.000 ARS anual
WHERE code = 'club';