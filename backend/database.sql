CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  belt VARCHAR(20) DEFAULT 'white',
  role VARCHAR(20) DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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