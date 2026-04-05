-- ==============================================
-- CREAR TABLAS ESENCIALES
-- ==============================================

-- 1. Tabla de clubs
CREATE TABLE IF NOT EXISTS clubs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER,
    current_plan_id INTEGER,
    subscription_status VARCHAR(50) DEFAULT 'trial',
    subscription_start_date TIMESTAMP,
    subscription_end_date TIMESTAMP,
    pending_plan_id INTEGER,
    pending_plan_start_date TIMESTAMP,
    address TEXT,
    email VARCHAR(100),
    phone VARCHAR(50),
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de planes
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

-- 3. Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    belt VARCHAR(50) DEFAULT 'white',
    role VARCHAR(50) DEFAULT 'student',
    club_id INTEGER REFERENCES clubs(id),
    is_approved BOOLEAN DEFAULT false,
    requested_club_id INTEGER REFERENCES clubs(id),
    request_message TEXT,
    phone VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Insertar club por defecto
INSERT INTO clubs (name, created_at) 
SELECT 'Academia Principal', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM clubs);

-- 5. Insertar planes por defecto
INSERT INTO plans (name, code, max_students, max_instructors, price_monthly, is_active) VALUES
('Gratuito', 'free', 20, 1, 0, true),
('Pro', 'pro', 100, 3, 9.99, true),
('Club', 'club', 999999, 999999, 29.99, true)
ON CONFLICT (code) DO NOTHING;

-- 6. Actualizar club con plan gratuito
UPDATE clubs 
SET current_plan_id = (SELECT id FROM plans WHERE code = 'free')
WHERE current_plan_id IS NULL;

-- 7. Tabla de técnicas
CREATE TABLE IF NOT EXISTS techniques (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50),
    belt_level VARCHAR(20) DEFAULT 'white',
    level VARCHAR(20) DEFAULT 'beginner',
    description TEXT,
    category VARCHAR(50) DEFAULT 'technique',
    created_by INTEGER REFERENCES users(id),
    approved BOOLEAN DEFAULT false,
    club_id INTEGER REFERENCES clubs(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tabla de videos de técnicas
CREATE TABLE IF NOT EXISTS technique_videos (
    id SERIAL PRIMARY KEY,
    technique_id INTEGER REFERENCES techniques(id) ON DELETE CASCADE,
    video_url VARCHAR(255) NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Tabla de sesiones de entrenamiento
CREATE TABLE IF NOT EXISTS training_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    techniques TEXT[],
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Tabla de eventos
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    date TIMESTAMP NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'general',
    description TEXT,
    torneo_data JSONB,
    created_by INTEGER REFERENCES users(id),
    club_id INTEGER REFERENCES clubs(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Tabla de game plans
CREATE TABLE IF NOT EXISTS gameplans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    position VARCHAR(50) DEFAULT 'guard',
    is_public BOOLEAN DEFAULT false,
    is_suggested BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Tabla de nodos de game plans
CREATE TABLE IF NOT EXISTS gameplan_nodes (
    id SERIAL PRIMARY KEY,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    technique_id VARCHAR(50),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. Tabla de conexiones de game plans
CREATE TABLE IF NOT EXISTS gameplan_connections (
    id SERIAL PRIMARY KEY,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    from_node INTEGER NOT NULL,
    to_node INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. Tabla de favoritos
CREATE TABLE IF NOT EXISTS gameplan_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, gameplan_id)
);

-- 15. Tabla de compartidos
CREATE TABLE IF NOT EXISTS gameplan_shares (
    id SERIAL PRIMARY KEY,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    from_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gameplan_id, to_user_id)
);

-- 16. Tabla de comentarios
CREATE TABLE IF NOT EXISTS gameplan_comments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    gameplan_id INTEGER REFERENCES gameplans(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 17. Tabla de notificaciones
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id),
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'pending',
    related_id INTEGER,
    scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 18. Tabla de refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 19. Tabla de horarios de entrenamiento
CREATE TABLE IF NOT EXISTS training_schedule (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id),
    day VARCHAR(20) NOT NULL,
    time VARCHAR(50) NOT NULL,
    class VARCHAR(100) NOT NULL,
    level VARCHAR(50) NOT NULL,
    day_order INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 20. Tabla de perfiles de usuario
CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    nickname VARCHAR(100),
    academy VARCHAR(255),
    profile_picture TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 21. Tabla de objetivos
CREATE TABLE IF NOT EXISTS user_objectives (
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

-- 22. Tabla de actividad de estudiantes
CREATE TABLE IF NOT EXISTS student_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_count INTEGER DEFAULT 0,
    last_session_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    objectives JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 23. Tabla de members (membresías)
CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    membership_plan_id INTEGER REFERENCES plans(id),
    status VARCHAR(20) DEFAULT 'active',
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 24. Tabla de pagos
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

-- 25. Tabla de preferencias de pago
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

-- Crear índices básicos
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_club_id ON users(club_id);
CREATE INDEX IF NOT EXISTS idx_techniques_club_id ON techniques(club_id);
CREATE INDEX IF NOT EXISTS idx_gameplans_user_id ON gameplans(user_id);
CREATE INDEX IF NOT EXISTS idx_gameplans_club_id ON gameplans(club_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- Insertar admin por defecto (contraseña: admin123)
INSERT INTO users (name, email, password, belt, role, club_id, is_approved)
SELECT 'Admin User', 'admin@bjj.com', '$2a$10$rOzZJb7UKbBQK1a0w1qgE.A6q9q9q9q9q9q9q9q9q9q9q9q9q9q9q', 'black', 'master', (SELECT id FROM clubs LIMIT 1), true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@bjj.com');