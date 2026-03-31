 require('dotenv').config();
console.log(require('dotenv').config());
console.log('JWT_SECRET:', process.env.JWT_SECRET); // Debe mostrar tu clave
const express = require('express');
const path = require('path');  // <-- AÑADE ESTO
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const os = require('os');
const fs = require('fs');

const app = express();
const { generatePDF } = require('./pdf-generator');
const { client, preference, payment } = require('./mercadopago-config');

// ========== MIDDLEWARES ESENCIALES ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración CORS para producción
const allowedOrigins = [
    'http://localhost:5000',
    'http://localhost:3000',
    'https://bjj-app-backend.onrender.com',
];

// Agregar la URL de producción como variable de entorno (recomendado)
if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (Postman, apps móviles)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('❌ CORS bloqueado para origen:', origin);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// ========== MIDDLEWARE DE DEBUG (AGREGAR TEMPORALMENTE) ==========
app.use((req, res, next) => {
    console.log(`📍 [DEBUG] ${req.method} ${req.url}`);
    next();
});

// ========== FUNCIONES DE VALIDACIÓN ==========

// Validar email
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// ==================== CONEXIÓN A POSTGRESQL ====================
console.log('🔗 Intentando conectar a PostgreSQL...');
console.log('📝 DATABASE_URL:', process.env.DATABASE_URL ? 'Definida' : 'NO definida');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Añade timeout para evitar conexiones colgadas
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20 // máximo de conexiones en el pool
});

// Event listeners para debug
pool.on('connect', (client) => {
  console.log('✅ Nueva conexión a PostgreSQL establecida');
});

pool.on('error', (err, client) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err);
  process.exit(-1); // Cierra la app si hay error crítico
});

// Función para probar la conexión al iniciar
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión a PostgreSQL verificada correctamente');
    client.release();
  } catch (err) {
    console.error('❌ ERROR: No se pudo conectar a PostgreSQL:', err.message);
    console.log('📋 Verifica:');
    console.log('   1. Que PostgreSQL esté ejecutándose');
    console.log('   2. Que la variable DATABASE_URL esté definida en .env');
    console.log('   3. Que las credenciales sean correctas');
    process.exit(1); // Sale si no puede conectar
  }
}

// Ejecutar test de conexión al iniciar
testConnection();

// ========== MIDDLEWARE DE AUTENTICACIÓN - VERSIÓN CORREGIDA ==========
const authenticateToken = async (req, res, next) => {
    try {
        console.log(`🔐 [AUTH] Verificando token para: ${req.path}`);
        
        // Extraer token
        let token = null;
        
        if (req.headers.authorization) {
            const authHeader = req.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else {
                token = authHeader;
            }
        }
        
        // Si no hay token, error
        if (!token) {
            console.log('❌ No se encontró token');
            return res.status(401).json({
                success: false,
                error: 'No autenticado',
                message: 'Token de autenticación requerido',
                code: 'MISSING_TOKEN'
            });
        }
        
        // Limpiar token
        token = token.trim();
        
        // Verificar token
        console.log('🔍 Verificando token...');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Verificar usuario en BD - INCLUIR CLUB_ID
        const userResult = await pool.query(
            'SELECT id, name, email, belt, role, club_id FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (userResult.rows.length === 0) {
            console.log('❌ Usuario no encontrado en BD');
            return res.status(401).json({
                success: false,
                error: 'Usuario no encontrado',
                code: 'USER_NOT_FOUND'
            });
        }
        
        // Adjuntar usuario al request
        req.user = userResult.rows[0];
        console.log(`✅ Autenticación exitosa para: ${req.user.name}`);
        console.log(`   Club ID: ${req.user.club_id}`);
        
        next();
        
    } catch (error) {
        console.log('❌ Error en autenticación:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expirado',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({
                success: false,
                error: 'Token inválido',
                code: 'INVALID_TOKEN'
            });
        }
        
        // Error general
        console.error('❌ Error inesperado en autenticación:', error);
        return res.status(500).json({
            success: false,
            error: 'Error de autenticación',
            code: 'AUTH_ERROR'
        });
    }
};

// Registrar usuario con solicitud de unión
app.post('/api/register', async (req, res) => {
    const { name, email, password, belt, role, clubId, academyName } = req.body;
    
    console.log('📝 Registrando usuario:', { name, email, role, belt });
    
    try {
        // Verificar si el usuario ya existe
        const userExists = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        let finalClubId = null;
        let isApproved = false;
        
        // Hash de la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        if (role === 'master') {
            // Validar nombre de academia
            if (!academyName || academyName.trim() === '') {
                return res.status(400).json({ error: 'El nombre de la academia es requerido para mestres' });
            }
            
            // Crear el club primero
            const newClub = await pool.query(
                `INSERT INTO clubs (name, created_at, subscription_status) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [academyName.trim(), new Date(), 'trial']
            );
            
            finalClubId = newClub.rows[0].id;
            isApproved = true; // Los mestres se aprueban automáticamente
            
            // Crear el usuario (mestre)
            const newUser = await pool.query(
                `INSERT INTO users 
                 (name, email, password, belt, role, club_id, is_approved, created_at, updated_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                 RETURNING id, name, email, belt, role, club_id, is_approved, created_at`,
                [name, email, hashedPassword, belt, role, finalClubId, isApproved, new Date(), new Date()]
            );
            
            const user = newUser.rows[0];
            
            // Actualizar el club con el owner_id (el mestre que creó el club)
            await pool.query(
                `UPDATE clubs SET owner_id = $1, updated_at = $2 WHERE id = $3`,
                [user.id, new Date(), finalClubId]
            );
            
            // Crear plan de suscripción por defecto
            await createDefaultPlanSubscription(finalClubId);
            
            // Generar tokens
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role, club_id: finalClubId, is_approved: user.is_approved },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            const refreshToken = jwt.sign(
                { id: user.id },
                process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            return res.json({
                token,
                refresh_token: refreshToken,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    belt: user.belt,
                    role: user.role,
                    club_id: finalClubId,
                    is_approved: user.is_approved
                }
            });
            
        } else if (role === 'student') {
            // Validar que se seleccionó una academia
            if (!clubId) {
                return res.status(400).json({ error: 'Debes seleccionar una academia' });
            }
            
            // Verificar que la academia existe
            const clubExists = await pool.query(
                'SELECT id, name FROM clubs WHERE id = $1',
                [clubId]
            );
            
            if (clubExists.rows.length === 0) {
                return res.status(400).json({ error: 'La academia seleccionada no existe' });
            }
            
            finalClubId = clubId;
            isApproved = false; // Los alumnos necesitan autorización
            
            // Crear el usuario (alumno)
            const newUser = await pool.query(
                `INSERT INTO users 
                 (name, email, password, belt, role, club_id, is_approved, created_at, updated_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                 RETURNING id, name, email, belt, role, club_id, is_approved, created_at`,
                [name, email, hashedPassword, belt, role, finalClubId, isApproved, new Date(), new Date()]
            );
            
            const user = newUser.rows[0];
            
            // Crear solicitud de membresía para alumnos
            await pool.query(
                `INSERT INTO membership_requests (user_id, club_id, status, request_date)
                 VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP)`,
                [user.id, finalClubId]
            );
            
            // Generar tokens
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role, club_id: finalClubId, is_approved: user.is_approved },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            const refreshToken = jwt.sign(
                { id: user.id },
                process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );
            
            return res.json({
                token,
                refresh_token: refreshToken,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    belt: user.belt,
                    role: user.role,
                    club_id: finalClubId,
                    is_approved: user.is_approved
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario: ' + error.message });
    }
});

// Función para crear plan de suscripción por defecto para un club nuevo
async function createDefaultPlanSubscription(clubId) {
    try {
        // Obtener el plan gratuito
        const freePlan = await pool.query(
            'SELECT id FROM plans WHERE code = $1',
            ['free']
        );
        
        if (freePlan.rows.length === 0) {
            console.log('⚠️ Plan gratuito no encontrado, omitiendo creación de suscripción');
            return;
        }
        
        const planId = freePlan.rows[0].id;
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1); // 1 mes de prueba
        
        // Crear suscripción
        await pool.query(
            `INSERT INTO club_subscriptions (club_id, plan_id, status, start_date, end_date, auto_renew)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [clubId, planId, 'active', startDate, endDate, true]
        );
        
        // Actualizar club con el plan actual
        await pool.query(
            `UPDATE clubs SET current_plan_id = $1, subscription_end_date = $2 WHERE id = $3`,
            [planId, endDate, clubId]
        );
        
        console.log(`✅ Plan gratuito asignado al club ${clubId}`);
        
    } catch (error) {
        console.error('Error creando suscripción por defecto:', error);
    }
}

// Login - asegurar que se obtiene el club_id
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Intento de login con:', email);

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Usuario no encontrado' });
        }

        const user = result.rows[0];
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(400).json({ error: 'Contraseña incorrecta' });
        }

        let clubId = user.club_id;
        
        // Si no tiene club_id, intentar obtenerlo o crearlo
        if (!clubId) {
            const clubResult = await pool.query(
                'SELECT id FROM clubs WHERE id IN (SELECT club_id FROM users WHERE id = $1)',
                [user.id]
            );
            
            if (clubResult.rows.length > 0) {
                clubId = clubResult.rows[0].id;
                await pool.query(
                    'UPDATE users SET club_id = $1 WHERE id = $2',
                    [clubId, user.id]
                );
            } else if (user.role === 'master') {
                // Crear club para mestre sin club
                const newClub = await pool.query(
                    `INSERT INTO clubs (name, owner_id, created_at) 
                     VALUES ($1, $2, $3) RETURNING id`,
                    [`Club de ${user.name}`, user.id, new Date()]
                );
                clubId = newClub.rows[0].id;
                await pool.query(
                    'UPDATE users SET club_id = $1 WHERE id = $2',
                    [clubId, user.id]
                );
            }
        }

        // Verificar aprobación
        let isApproved = user.is_approved || false;
        if (user.role === 'student' && !isApproved) {
            const requestCheck = await pool.query(
                'SELECT status FROM membership_requests WHERE user_id = $1 ORDER BY request_date DESC LIMIT 1',
                [user.id]
            );
            if (requestCheck.rows.length > 0 && requestCheck.rows[0].status === 'approved') {
                isApproved = true;
                await pool.query(
                    'UPDATE users SET is_approved = true WHERE id = $1',
                    [user.id]
                );
            }
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                club_id: clubId,
                name: user.name,
                belt: user.belt,
                is_approved: isApproved
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const refreshToken = jwt.sign(
            { id: user.id },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
            [user.id, refreshToken]
        );

        res.json({
            token,
            refresh_token: refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                belt: user.belt,
                role: user.role,
                club_id: clubId,
                is_approved: isApproved
            }
        });

    } catch (err) {
        console.error('Error detallado en login:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Endpoint de emergencia para restablecer contraseña
app.post('/api/emergency-reset', async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        
        // Solo permitir en desarrollo
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ error: 'No permitido en producción' });
        }

        console.log('Restableciendo contraseña para:', email);
        
        // Hashear la nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        console.log('Nuevo hash:', hashedPassword);

        // Actualizar en la base de datos
        const result = await pool.query(
            'UPDATE users SET password = $1 WHERE email = $2 RETURNING id, email',
            [hashedPassword, email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ 
            message: 'Contraseña restablecida exitosamente',
            user: result.rows[0],
            password: newPassword // Solo para desarrollo
        });
    } catch (err) {
        console.error('Error en emergency-reset:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Test de bcrypt al iniciar el servidor
async function testBcrypt() {
    try {
        console.log('=== TESTING BCRYPT ===');
        const testPassword = 'Niebla631';
        const testHash = await bcrypt.hash(testPassword, 10);
        console.log('Password:', testPassword);
        console.log('Hash generated:', testHash);
        
        const isValid = await bcrypt.compare(testPassword, testHash);
        console.log('Self-comparison result:', isValid);
        
        // Test con el hash de la base de datos
        const dbHash = '$2b$10$4/uNvwMme4KwWm38EPet7umGucJY46/asfZvdrqhaKYgn9MsCJaWi';
        const isDbValid = await bcrypt.compare('Niebla631', dbHash);
        console.log('Database hash comparison:', isDbValid);
        
    } catch (error) {
        console.error('BCRYPT TEST ERROR:', error);
    }
}

// Llama a la función después de conectar a la BD
testBcrypt();


// ==================== RUTAS PROTEGIDAS ====================
// Obtener sesión específica
app.get('/api/training-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ts.*, u.name as user_name
       FROM training_sessions ts
       JOIN users u ON ts.user_id = u.id
       WHERE ts.id = $1 AND (ts.user_id = $2 OR $3 = 'master')`,
      [id, req.user.id, req.user.role]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo sesión:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener todas las sesiones del usuario - VERSIÓN CON LOGGING
app.get('/api/training-sessions', authenticateToken, async (req, res) => {
    try {
        console.log(`🏋️ [SESSIONS] Obteniendo sesiones para usuario: ${req.user.id} (${req.user.name})`);
        
        const result = await pool.query(
            `SELECT ts.*, u.name as user_name 
             FROM training_sessions ts 
             JOIN users u ON ts.user_id = u.id 
             WHERE ts.user_id = $1 
             ORDER BY ts.date DESC`,
            [req.user.id]
        );
        
        console.log(`✅ [SESSIONS] Consulta BD exitosa. Encontradas: ${result.rows.length} sesiones`);
        
        // Loggear algunas sesiones para debug
        if (result.rows.length > 0) {
            console.log('   Ejemplo de sesiones encontradas:');
            result.rows.slice(0, 3).forEach((session, i) => {
                console.log(`     ${i + 1}. ID: ${session.id}, Fecha: ${session.date}, Técnicas: ${session.techniques?.length || 0}`);
            });
        }
        
        res.json(result.rows);
        
    } catch (err) {
        console.error('❌ [SESSIONS] Error obteniendo sesiones:', err);
        console.error('   Error stack:', err.stack);
        res.status(500).json({ 
            error: 'Error del servidor',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Crear nueva sesión de entrenamiento - ACTUALIZADO
app.post('/api/training-sessions', authenticateToken, async (req, res) => {
  try {
    const { date, techniques, notes, rating } = req.body;
    
    // Validaciones básicas
    if (!date || !techniques || !notes || !rating) {
      return res.status(400).json({ error: 'Todos los campos son requeridos, incluyendo la calificación' });
    }

    if (rating < 1 || rating > 10) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 10' });
    }

    // Convertir técnicas a array si viene como string
    let techniquesArray = techniques;
    if (typeof techniques === 'string') {
      techniquesArray = techniques.split(',').map(tech => tech.trim()).filter(tech => tech.length > 0);
    }

    const result = await pool.query(
      `INSERT INTO training_sessions (user_id, date, techniques, notes, rating) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, date, techniquesArray, notes, rating]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creando sesión de entrenamiento:', err);
    res.status(500).json({ error: 'Error creando sesión de entrenamiento' });
  }
});

// Comentar sesión de entrenamiento (solo mestres)
app.post('/api/training-sessions/:id/comment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden comentar' });
    }
    const sessionCheck = await pool.query(
      'SELECT * FROM training_sessions WHERE id = $1',
      [id]
    );
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    const result = await pool.query(
      'INSERT INTO comments (user_id, training_session_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error añadiendo comentario:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta para copiar game plans al añadir a favoritos
app.post('/api/gameplans/copy', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { gameplan_id, attributed_to } = req.body;
        
        console.log('📋 Solicitando copia del game plan:', gameplan_id);
        
        // Validar campos requeridos
        if (!gameplan_id) {
            return res.status(400).json({ error: 'ID del game plan es requerido' });
        }

        // Obtener el game plan original
        const originalPlanResult = await client.query(
            `SELECT g.*, u.name as creator_name,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'id', n.id,
                                'technique_id', n.technique_id,
                                'name', n.name,
                                'type', n.type,
                                'x', n.x,
                                'y', n.y
                            )
                        ) FILTER (WHERE n.id IS NOT NULL), '[]'
                    ) AS nodes,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'id', c.id,
                                'from_node', c.from_node,
                                'to_node', c.to_node
                            )
                        ) FILTER (WHERE c.id IS NOT NULL), '[]'
                    ) AS connections
             FROM gameplans g
             LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
             LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
             LEFT JOIN users u ON g.user_id = u.id
             WHERE g.id = $1
             GROUP BY g.id, u.name`,
            [gameplan_id]
        );
        
        if (originalPlanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado' });
        }
        
        const plan = originalPlanResult.rows[0];
        
        await client.query('BEGIN');
        
        // Insertar nuevo game plan con atribución
        const newPlanResult = await client.query(
            `INSERT INTO gameplans (user_id, name, description, position, is_public, is_suggested)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                req.user.id, 
                plan.name, 
                `Compartido por: ${attributed_to || plan.creator_name || 'Usuario'} (${new Date().toLocaleDateString()})\n${plan.description || ''}`,
                plan.position || 'guard', 
                false,
                false
            ]
        );
        
        const newPlanId = newPlanResult.rows[0].id;
        
        // Copiar nodos
        for (let node of plan.nodes) {
            await client.query(
                `INSERT INTO gameplan_nodes (gameplan_id, technique_id, name, type, x, y)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [newPlanId, node.technique_id, node.name, node.type, node.x, node.y]
            );
        }
        
        // Obtener los nuevos IDs de los nodos
        const newNodesResult = await client.query(
            'SELECT id FROM gameplan_nodes WHERE gameplan_id = $1 ORDER BY id',
            [newPlanId]
        );
        
        // Crear mapeo de IDs viejos a nuevos
        const nodeIdMap = {};
        for (let i = 0; i < plan.nodes.length; i++) {
            if (plan.nodes[i].id && newNodesResult.rows[i]) {
                nodeIdMap[plan.nodes[i].id] = newNodesResult.rows[i].id;
            }
        }
        
        // Copiar conexiones
        for (let conn of plan.connections) {
            const fromNewId = nodeIdMap[conn.from_node];
            const toNewId = nodeIdMap[conn.to_node];
            
            if (fromNewId && toNewId) {
                await client.query(
                    `INSERT INTO gameplan_connections (gameplan_id, from_node, to_node)
                     VALUES ($1, $2, $3)`,
                    [newPlanId, fromNewId, toNewId]
                );
            }
        }
        
        await client.query('COMMIT');
        
        // Devolver el nuevo game plan
        const newPlanFull = await client.query(
            `SELECT g.*, 
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'id', n.id,
                                'technique_id', n.technique_id,
                                'name', n.name,
                                'type', n.type,
                                'x', n.x,
                                'y', n.y
                            )
                        ) FILTER (WHERE n.id IS NOT NULL), '[]'
                    ) AS nodes,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'id', c.id,
                                'from_node', c.from_node,
                                'to_node', c.to_node
                            )
                        ) FILTER (WHERE c.id IS NOT NULL), '[]'
                    ) AS connections
             FROM gameplans g
             LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
             LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
             WHERE g.id = $1
             GROUP BY g.id`,
            [newPlanId]
        );
        
        console.log('✅ Game Plan copiado exitosamente:', newPlanId);
        res.status(201).json(newPlanFull.rows[0]);
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error copiando game plan:', err);
        res.status(500).json({ error: 'Error del servidor al copiar el game plan' });
    } finally {
        client.release();
    }
});

// ==================== COMENTARIOS DE GAME PLANS ====================

// Obtener comentarios de un game plan
app.get('/api/gameplans/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        console.log('📥 Solicitando comentarios para game plan:', id);
        
        const result = await pool.query(
            `SELECT gc.*, u.name as user_name, u.role as user_role
             FROM gameplan_comments gc
             JOIN users u ON gc.user_id = u.id
             WHERE gc.gameplan_id = $1
             ORDER BY gc.created_at DESC`,
            [id]
        );
        
        console.log('✅ Comentarios encontrados:', result.rows.length);
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error obteniendo comentarios:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Añadir comentario a un game plan
app.post('/api/gameplans/:id/comments', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id } = req.params;
        const { content } = req.body;
        
        console.log('📝 Añadiendo comentario a game plan:', id);
        
        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'El contenido del comentario no puede estar vacío' });
        }

        // Verificar que el game plan existe y el usuario tiene acceso
        const accessCheck = await client.query(
            `SELECT g.id 
             FROM gameplans g
             LEFT JOIN gameplan_shares s ON g.id = s.gameplan_id
             WHERE g.id = $1 AND (g.is_public = true OR g.user_id = $2 OR s.to_user_id = $2)`,
            [id, req.user.id]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'No tienes acceso a este game plan' });
        }

        await client.query('BEGIN');

        // Verificar comentario duplicado
        const duplicateCheck = await client.query(
            `SELECT id FROM gameplan_comments 
             WHERE gameplan_id = $1 AND user_id = $2 AND content = $3 
             AND created_at > NOW() - INTERVAL '5 seconds'`,
            [id, req.user.id, content.trim()]
        );

        if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Comentario duplicado detectado' });
        }

        const result = await client.query(
            `INSERT INTO gameplan_comments (user_id, gameplan_id, content) 
             VALUES ($1, $2, $3) 
             RETURNING *, 
             (SELECT name FROM users WHERE id = $1) as user_name,
             (SELECT role FROM users WHERE id = $1) as user_role`,
            [req.user.id, id, content.trim()]
        );
        
        await client.query('COMMIT');
        
        console.log('✅ Comentario añadido:', result.rows[0]);
        res.status(201).json(result.rows[0]);
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error añadiendo comentario:', err);
        
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Comentario duplicado detectado' });
        }
        
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});


// Eliminar comentarios (solo dueños del comentario o mestres)
app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si el comentario existe y quién es el dueño
        const commentCheck = await pool.query(
            'SELECT * FROM gameplan_comments WHERE id = $1',
            [id]
        );
        
        if (commentCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Comentario no encontrado' });
        }
        
        const comment = commentCheck.rows[0];
        
        // Verificar permisos: solo el dueño del comentario o un mestre puede eliminarlo
        const canDelete = req.user.role === 'master' || comment.user_id === req.user.id;
        
        if (!canDelete) {
            return res.status(403).json({ error: 'No tienes permisos para eliminar este comentario' });
        }
        
        await pool.query('DELETE FROM gameplan_comments WHERE id = $1', [id]);
        res.json({ message: 'Comentario eliminado correctamente' });
        
    } catch (err) {
        console.error('Error eliminando comentario:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Ruta temporal para limpiar objetivos - EJECUTAR UNA VEZ Y LUEGO ELIMINAR
app.delete('/api/debug/clean-objectives', authenticateToken, async (req, res) => {
    try {
        console.log('🧹 Limpiando todos los objetivos del usuario:', req.user.id);
        
        await pool.query('DELETE FROM user_objectives WHERE user_id = $1', [req.user.id]);
        
        res.json({ 
            message: 'Objetivos eliminados correctamente',
            deleted_user_id: req.user.id
        });
    } catch (error) {
        console.error('Error limpiando objetivos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener técnicas del club
app.get('/api/techniques', authenticateToken, async (req, res) => {
    try {
        const { search, type, level, belt, category } = req.query;
        
        let query = `
            SELECT t.*, u.name as creator_name, 
                   COALESCE( 
                       json_agg(tv.video_url) 
                       FILTER (WHERE tv.video_url IS NOT NULL), 
                       '[]' 
                   ) as video_urls 
            FROM techniques t 
            LEFT JOIN users u ON t.created_by = u.id 
            LEFT JOIN technique_videos tv ON t.id = tv.technique_id 
            WHERE (t.club_id = $1 OR t.club_id IS NULL)
        `;
        
        let params = [req.user.club_id];
        let paramCount = 1;
        
        if (search) {
            query += ` AND (t.name ILIKE $${++paramCount} OR t.description ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        if (type && type !== 'all') {
            query += ` AND t.type = $${++paramCount}`;
            params.push(type);
        }
        
        if (level && level !== 'all') {
            query += ` AND t.level = $${++paramCount}`;
            params.push(level);
        }
        
        if (belt && belt !== 'all') {
            query += ` AND t.belt_level = $${++paramCount}`;
            params.push(belt);
        }
        
        if (category && category !== 'all') {
            query += ` AND t.category = $${++paramCount}`;
            params.push(category);
        }
        
        query += ' GROUP BY t.id, u.name ORDER BY t.created_at DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (err) {
        console.error('Error obteniendo técnicas:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener videos de una técnica
app.get('/api/techniques/:id/videos', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'ID de técnica inválido' });
    }
    const result = await pool.query(
      'SELECT * FROM technique_videos WHERE technique_id = $1 ORDER BY is_primary DESC, created_at',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo videos:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear nueva técnica - ASIGNAR CLUB_ID
app.post('/api/techniques', authenticateToken, async (req, res) => {
    try {
        const { name, type, belt_level, level, description, video_urls, category } = req.body;
        
        console.log('📥 Creando técnica/pelea con datos:', req.body);
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }
        
        if (!description || description.trim() === '') {
            return res.status(400).json({ error: 'La descripción es requerida' });
        }
        
        if (category !== 'fight' && (!type || type.trim() === '')) {
            return res.status(400).json({ error: 'El tipo de técnica es requerido' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            let techniqueTypeValue, techniqueBeltValue, techniqueLevelValue;
            
            if (category === 'fight') {
                techniqueTypeValue = null;
                techniqueBeltValue = null;
                techniqueLevelValue = null;
            } else {
                techniqueTypeValue = type;
                techniqueBeltValue = belt_level || 'white';
                techniqueLevelValue = level || 'beginner';
            }
            
            // 🔥 AGREGAR club_id a la técnica
            const techniqueResult = await client.query(
                `INSERT INTO techniques (name, type, belt_level, level, description, created_by, approved, category, club_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [
                    name.trim(),
                    techniqueTypeValue,
                    techniqueBeltValue,
                    techniqueLevelValue,
                    description.trim(),
                    req.user.id,
                    req.user.role === 'master',
                    category || 'technique',
                    req.user.club_id  // 🔥 ASIGNAR CLUB_ID
                ]
            );
            
            const technique = techniqueResult.rows[0];
            
            if (video_urls && video_urls.length > 0) {
                for (let i = 0; i < video_urls.length; i++) {
                    const videoUrl = video_urls[i];
                    if (videoUrl && videoUrl.trim() !== '') {
                        await client.query(
                            `INSERT INTO technique_videos (technique_id, video_url, is_primary)
                             VALUES ($1, $2, $3)`,
                            [technique.id, videoUrl.trim(), i === 0]
                        );
                    }
                }
            }
            
            await client.query('COMMIT');
            
            const finalResult = await pool.query(
                `SELECT t.*, u.name as creator_name,
                        COALESCE(
                          json_agg(tv.video_url ORDER BY tv.is_primary DESC, tv.created_at) 
                          FILTER (WHERE tv.video_url IS NOT NULL), '[]'
                        ) as video_urls
                 FROM techniques t
                 LEFT JOIN users u ON t.created_by = u.id
                 LEFT JOIN technique_videos tv ON t.id = tv.technique_id
                 WHERE t.id = $1
                 GROUP BY t.id, u.name`,
                [technique.id]
            );
            
            res.status(201).json(finalResult.rows[0]);
            
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('❌ Error creando técnica/pelea:', err);
        res.status(500).json({ error: 'Error creando técnica/pelea' });
    }
});


// Actualizar técnica o pelea - VERSIÓN COMPLETA CORREGIDA
app.put('/api/techniques/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, belt_level, level, description, video_urls, category } = req.body;
    
    console.log('✏️ Actualizando técnica/pelea ID:', id, 'Datos:', req.body);
    
    // Verificar que existe
    const techniqueCheck = await pool.query(
      'SELECT * FROM techniques WHERE id = $1',
      [id]
    );
    
    if (techniqueCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Técnica no encontrada' });
    }
    
    const technique = techniqueCheck.rows[0];
    
    // Verificar permisos: dueño o mestre
    const canEdit = technique.created_by === req.user.id || req.user.role === 'master';
    if (!canEdit) {
      return res.status(403).json({ error: 'No tienes permisos para editar esta técnica/pelea' });
    }
    
    // VALIDACIONES MEJORADAS
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    if (!description || description.trim() === '') {
      return res.status(400).json({ error: 'La descripción es requerida' });
    }
    
    // Para TÉCNICAS (no peleas), validar tipo
    if (category !== 'fight' && (!type || type.trim() === '')) {
      return res.status(400).json({ error: 'El tipo de técnica es requerido' });
    }
    
    // Para TÉCNICAS (no peleas), validar nivel y cinturón
    if (category !== 'fight') {
      if (!belt_level || belt_level.trim() === '') {
        return res.status(400).json({ error: 'El nivel de cinturón es requerido para técnicas' });
      }
      if (!level || level.trim() === '') {
        return res.status(400).json({ error: 'El nivel de dificultad es requerido para técnicas' });
      }
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
// PREPARAR VALORES SEGÚN CATEGORÍA - VERSIÓN CORREGIDA
let techniqueTypeValue, techniqueBeltValue, techniqueLevelValue;

if (category === 'fight') {
  // Para peleas, usar valores por defecto pero permitir NULL
  techniqueTypeValue = null;
  techniqueBeltValue = null;
  techniqueLevelValue = null;
} else {
  // Para técnicas, validar y usar los valores proporcionados
  if (!type || type.trim() === '') {
    return res.status(400).json({ error: 'El tipo de técnica es requerido' });
  }
  techniqueTypeValue = type;
  techniqueBeltValue = belt_level || 'white';
  techniqueLevelValue = level || 'beginner';
}

console.log('🔄 Valores procesados:', {
  id,
  name: name.trim(),
  type: techniqueTypeValue,
  belt_level: techniqueBeltValue,
  level: techniqueLevelValue,
  category: category || 'technique'
});
      
      // Actualizar técnica/pelea
const updateResult = await client.query(
  `UPDATE techniques SET name = $1, type = $2, belt_level = $3, level = $4, description = $5, category = $6, approved = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING *`,
  [
    name.trim(),
    techniqueTypeValue,
    techniqueBeltValue,
    techniqueLevelValue,
    description.trim(),
    category || 'technique',
    // Solo mestres mantienen el estado de aprobación, usuarios normales se ponen en pendiente
    req.user.role === 'master' ? technique.approved : false,
    id
  ]
);
      
      const updatedTechnique = updateResult.rows[0];
      console.log('✅ Técnica/pelea actualizada:', updatedTechnique.name);
      
      // GESTIÓN DE VIDEOS: Eliminar existentes y agregar nuevos
      await client.query('DELETE FROM technique_videos WHERE technique_id = $1', [id]);
      
      if (video_urls && video_urls.length > 0) {
        console.log(`📹 Insertando ${video_urls.length} videos para técnica ID ${id}`);
        
        for (let i = 0; i < video_urls.length; i++) {
          const videoUrl = video_urls[i];
          if (videoUrl && videoUrl.trim() !== '') {
            await client.query(
              `INSERT INTO technique_videos (technique_id, video_url, is_primary)
               VALUES ($1, $2, $3)`,
              [id, videoUrl.trim(), i === 0] // El primer video es el principal
            );
            console.log(`   ✅ Video ${i + 1}: ${videoUrl}`);
          }
        }
      } else {
        console.log('ℹ️ No hay videos para esta técnica/pelea');
      }
      
      await client.query('COMMIT');
      
      // OBTENER TÉCNICA ACTUALIZADA CON DATOS COMPLETOS
      const finalResult = await pool.query(
        `SELECT t.*, u.name as creator_name, u.email as creator_email,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'url', tv.video_url,
                      'is_primary', tv.is_primary,
                      'created_at', tv.created_at
                    ) ORDER BY tv.is_primary DESC, tv.created_at
                  ) FILTER (WHERE tv.video_url IS NOT NULL), '[]'
                ) as video_urls
         FROM techniques t
         LEFT JOIN users u ON t.created_by = u.id
         LEFT JOIN technique_videos tv ON t.id = tv.technique_id
         WHERE t.id = $1
         GROUP BY t.id, u.name, u.email`,
        [id]
      );
      
      const finalTechnique = finalResult.rows[0];
      console.log('🎯 Técnica/pelea actualizada completamente:', finalTechnique.name);
      
      res.json(finalTechnique);
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Error en transacción:', err);
      
      // MEJORES MENSAJES DE ERROR
      if (err.code === '23505') {
        return res.status(400).json({ error: 'Ya existe otra técnica/pelea con ese nombre' });
      }
      
      if (err.code === '23503') {
        return res.status(400).json({ error: 'Usuario no válido' });
      }
      
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Error editando técnica/pelea:', err);
    res.status(500).json({ 
      error: 'Error editando técnica/pelea',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Técnicas pendientes - filtrar por club
app.get('/api/techniques/pending', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const result = await pool.query(
            `SELECT t.*, u.name as creator_name,
                    COALESCE(
                      json_agg(tv.video_url ORDER BY tv.is_primary DESC, tv.created_at) 
                      FILTER (WHERE tv.video_url IS NOT NULL), '[]'
                    ) as video_urls
             FROM techniques t
             LEFT JOIN users u ON t.created_by = u.id
             LEFT JOIN technique_videos tv ON t.id = tv.technique_id
             WHERE t.approved = false AND t.club_id = $1
             GROUP BY t.id, u.name`,
            [req.user.club_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo técnicas pendientes:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ✅ AGREGA este endpoint para obtener una técnica específica
app.get('/api/techniques/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT t.*, u.name as creator_name,
              COALESCE(
                json_agg(tv.video_url ORDER BY tv.is_primary DESC, tv.created_at) 
                FILTER (WHERE tv.video_url IS NOT NULL), '[]'
              ) as video_urls
       FROM techniques t
       LEFT JOIN users u ON t.created_by = u.id
       LEFT JOIN technique_videos tv ON t.id = tv.technique_id
       WHERE t.id = $1
       GROUP BY t.id, u.name`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Técnica no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo técnica:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener y gestionar 
//  (todas las rutas protegidas)
app.get('/api/gameplans', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                g.*, 
                u.name AS creator_name,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', n.id,
                            'technique_id', n.technique_id,
                            'name', n.name,
                            'type', n.type,
                            'x', n.x,
                            'y', n.y
                        )
                    ) FILTER (WHERE n.id IS NOT NULL), '[]'
                ) AS nodes,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', c.id,
                            'from_node', c.from_node,
                            'to_node', c.to_node
                        )
                    ) FILTER (WHERE c.id IS NOT NULL), '[]'
                ) AS connections,
                EXISTS (
                    SELECT 1 FROM gameplan_favorites f 
                    WHERE f.gameplan_id = g.id AND f.user_id = $1
                ) AS is_favorite
            FROM gameplans g
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE g.user_id = $1 OR g.is_public = true OR g.id IN (
                SELECT gameplan_id FROM gameplan_shares WHERE to_user_id = $1
            )
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo game plans:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }})

// Mis planes
app.get('/api/gameplans/my', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                g.*, 
                u.name AS creator_name,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', n.id,
                            'technique_id', n.technique_id,
                            'name', n.name,
                            'type', n.type,
                            'x', n.x,
                            'y', n.y
                        )
                    ) FILTER (WHERE n.id IS NOT NULL), '[]'
                ) AS nodes,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', c.id,
                            'from_node', c.from_node,
                            'to_node', c.to_node
                        )
                    ) FILTER (WHERE c.id IS NOT NULL), '[]'
                ) AS connections,
                EXISTS (
                    SELECT 1 FROM gameplan_favorites f 
                    WHERE f.gameplan_id = g.id AND f.user_id = $1
                ) AS is_favorite
            FROM gameplans g
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE g.user_id = $1 AND g.club_id = $2
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC
        `, [req.user.id, req.user.club_id]);
        
        console.log(`Encontrados ${result.rows.length} game plans para usuario ${req.user.id}`);
        if (result.rows.length > 0) {
            console.log('Primer plan - descripción:', result.rows[0].description);
        }
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo mis game plans:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Favoritos
app.get('/api/gameplans/favorites', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT g.*, u.name AS creator_name,
                   COALESCE(json_agg(DISTINCT n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS nodes,
                   COALESCE(json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL), '[]') AS connections,
                   true AS is_favorite
            FROM gameplan_favorites f
            JOIN gameplans g ON f.gameplan_id = g.id
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE f.user_id = $1
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo favoritos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Planes del Club (Públicos)
app.get('/api/gameplans/public', authenticateToken, async (req, res) => {
    try {
        const { position } = req.query;
        
        let query = `
            SELECT 
                g.*, 
                u.name AS creator_name,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', n.id,
                            'technique_id', n.technique_id,
                            'name', n.name,
                            'type', n.type,
                            'x', n.x,
                            'y', n.y
                        )
                    ) FILTER (WHERE n.id IS NOT NULL), '[]'
                ) AS nodes,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', c.id,
                            'from_node', c.from_node,
                            'to_node', c.to_node
                        )
                    ) FILTER (WHERE c.id IS NOT NULL), '[]'
                ) AS connections,
                EXISTS (
                    SELECT 1 FROM gameplan_favorites f 
                    WHERE f.gameplan_id = g.id AND f.user_id = $1
                ) AS is_favorite
            FROM gameplans g
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE g.is_public = true AND g.club_id = $2
        `;
        
        const params = [req.user.id, req.user.club_id];
        let paramCount = 2;
        
        if (position && position !== 'all') {
            query += ` AND g.position = $${++paramCount}`;
            params.push(position);
        }
        
        query += ` GROUP BY g.id, u.name ORDER BY g.updated_at DESC`;
        
        const result = await pool.query(query, params);
        
        console.log(`✅ Encontrados ${result.rows.length} game plans públicos`);
        if (result.rows.length > 0) {
            console.log('Primer plan público - descripción:', result.rows[0].description);
        }
        res.json(result.rows);
        
    } catch (err) {
        console.error('❌ Error obteniendo game plans públicos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Compartidos conmigo
app.get('/api/gameplans/shared', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT g.*, u.name AS creator_name,
                   COALESCE(json_agg(DISTINCT n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS nodes,
                   COALESCE(json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL), '[]') AS connections
            FROM gameplan_shares s
            JOIN gameplans g ON s.gameplan_id = g.id
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE s.to_user_id = $1
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo game plans compartidos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.get('/api/gameplans/suggested', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, u.name AS creator_name,
             COALESCE(json_agg(DISTINCT n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS nodes,
             COALESCE(json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL), '[]') AS connections
      FROM gameplans g
      LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
      LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
      LEFT JOIN users u ON g.user_id = u.id
      WHERE g.is_suggested = true
      GROUP BY g.id, u.name
      ORDER BY g.updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo game plans sugeridos:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta para refrescar tokens
app.post('/api/refresh-token', async (req, res) => {
    try {
        const { refresh_token } = req.body;
        
        if (!refresh_token) {
            return res.status(400).json({ error: 'Refresh token requerido' });
        }

        // Verificar el refresh token en la base de datos
        const result = await pool.query(
            'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
            [refresh_token]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Refresh token inválido o expirado' });
        }

        const userId = result.rows[0].user_id;
        
        // Obtener información del usuario
        const userResult = await pool.query(
            'SELECT id, name, email, belt, role FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const user = userResult.rows[0];
        
        // Generar NUEVO token de acceso
        const newToken = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Generar NUEVO refresh token
        const newRefreshToken = jwt.sign(
            { id: user.id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        // Eliminar refresh token viejo y guardar el nuevo
        await pool.query('BEGIN');
        await pool.query(
            'DELETE FROM refresh_tokens WHERE token = $1',
            [refresh_token]
        );
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
            [user.id, newRefreshToken]
        );
        await pool.query('COMMIT');

        // Responder con los nuevos tokens
        res.json({
            token: newToken,
            refresh_token: newRefreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                belt: user.belt,
                role: user.role
            }
        });
        
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error en refresh token:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear nuevo game plan
app.post('/api/gameplans', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { name, description, position, is_public, is_suggested, nodes, connections } = req.body;
        
        console.log('🆕 Creando nuevo game plan:', name);
        console.log('📝 Descripción recibida:', description);
        console.log('📦 Datos recibidos - Nodos:', nodes?.length, 'Conexiones:', connections?.length);

        // Validar campos requeridos
        if (!name || !nodes) {
            return res.status(400).json({ error: 'Nombre y nodos son requeridos' });
        }

        await client.query('BEGIN');

        // Insertar game plan básico con club_id y descripción
        const insertGP = await client.query(
            `INSERT INTO gameplans (user_id, club_id, name, description, position, is_public, is_suggested)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.user.id, req.user.club_id, name, description || '', position || 'guard', is_public || false, is_suggested || false]
        );
        
        const gameplanId = insertGP.rows[0].id;
        console.log('✅ Game Plan creado con ID:', gameplanId);
        console.log('📝 Descripción guardada:', description || '');

        // Mapeo para guardar la relación entre IDs temporales y reales
        const nodeIdMap = {};

        // Insertar nodos
        if (nodes && nodes.length > 0) {
            console.log('📝 Insertando', nodes.length, 'nodos...');
            
            for (let node of nodes) {
                const result = await client.query(
                    `INSERT INTO gameplan_nodes (gameplan_id, technique_id, name, type, x, y)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [gameplanId, node.technique_id || null, node.name, node.type || 'technique', node.x || 0, node.y || 0]
                );
                
                nodeIdMap[node.id] = result.rows[0].id;
            }
        }

        console.log('🗺️ Mapeo de IDs de nodos:', nodeIdMap);

        // Insertar conexiones usando el mapeo de IDs
        if (connections && connections.length > 0) {
            console.log('🔗 Insertando', connections.length, 'conexiones...');
            
            for (let conn of connections) {
                const fromDbId = nodeIdMap[conn.from_node];
                const toDbId = nodeIdMap[conn.to_node];
                
                if (fromDbId && toDbId) {
                    await client.query(
                        `INSERT INTO gameplan_connections (gameplan_id, from_node, to_node)
                         VALUES ($1, $2, $3)`,
                        [gameplanId, fromDbId, toDbId]
                    );
                    console.log('✅ Conexión creada exitosamente');
                } else {
                    console.warn('⚠️ No se pudo mapear conexión:', conn);
                }
            }
        }

        await client.query('COMMIT');

        // Obtener el game plan completo recién creado
        const fullGP = await pool.query(
            `SELECT g.*, u.name AS creator_name,
                    COALESCE(
                      json_agg(
                        DISTINCT jsonb_build_object(
                          'id', n.id,
                          'technique_id', n.technique_id,
                          'name', n.name,
                          'type', n.type,
                          'x', n.x,
                          'y', n.y
                        )
                      ) FILTER (WHERE n.id IS NOT NULL), '[]'
                    ) AS nodes,
                    COALESCE(
                      json_agg(
                        DISTINCT jsonb_build_object(
                          'id', c.id,
                          'from_node', c.from_node,
                          'to_node', c.to_node
                        )
                      ) FILTER (WHERE c.id IS NOT NULL), '[]'
                    ) AS connections
             FROM gameplans g
             LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
             LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
             LEFT JOIN users u ON g.user_id = u.id
             WHERE g.id = $1
             GROUP BY g.id, u.name`,
            [gameplanId]
        );

        console.log('✅ Game Plan creado exitosamente con', 
                    fullGP.rows[0].nodes.length, 'nodos y', 
                    fullGP.rows[0].connections.length, 'conexiones');
        console.log('📝 Descripción en respuesta:', fullGP.rows[0].description);
        
        res.status(201).json(fullGP.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR creando game plan:', err);
        res.status(500).json({ 
            error: 'Error creando game plan',
            message: err.message,
            details: err.stack
        });
    } finally {
        client.release();
    }
});

// EN SERVER.JS - CORREGIR LA RUTA PUT /api/gameplans/:id
app.put('/api/gameplans/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id } = req.params;
        const { name, description, position, is_public, is_suggested, nodes, connections } = req.body;

        console.log('🔄 Actualizando game plan ID:', id);
        console.log('📝 Datos recibidos:');
        console.log('   Nombre:', name);
        console.log('   Descripción:', description);
        console.log('   Posición:', position);
        console.log('   Público:', is_public);
        console.log('   Sugerido:', is_suggested);
        console.log('   Nodos:', nodes?.length);
        console.log('   Conexiones:', connections?.length);

        // Validar campos requeridos
        if (!name) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        // Verificar que el gameplan existe y pertenece al usuario
        const gameplanCheck = await client.query(
            'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        
        if (gameplanCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado' });
        }

        await client.query('BEGIN');

        // Actualizar información básica del gameplan - INCLUIR description explícitamente
        await client.query(
            `UPDATE gameplans 
             SET name = $1, 
                 description = $2, 
                 position = $3, 
                 is_public = $4, 
                 is_suggested = $5, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [name, description || '', position || 'guard', is_public || false, is_suggested || false, id]
        );

        // Eliminar nodos y conexiones existentes
        await client.query('DELETE FROM gameplan_nodes WHERE gameplan_id = $1', [id]);
        await client.query('DELETE FROM gameplan_connections WHERE gameplan_id = $1', [id]);

        // Insertar nuevos nodos y guardar el mapeo de IDs
        const nodeIdMap = {};
        if (nodes && nodes.length > 0) {
            for (const node of nodes) {
                const result = await client.query(
                    `INSERT INTO gameplan_nodes (gameplan_id, technique_id, name, type, x, y)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [id, node.technique_id, node.name, node.type, node.x, node.y]
                );
                nodeIdMap[node.id] = result.rows[0].id;
            }
        }

        // Insertar nuevas conexiones usando el mapeo de IDs
        if (connections && connections.length > 0) {
            for (const conn of connections) {
                const fromDbId = nodeIdMap[conn.from_node];
                const toDbId = nodeIdMap[conn.to_node];
                
                if (fromDbId && toDbId) {
                    await client.query(
                        `INSERT INTO gameplan_connections (gameplan_id, from_node, to_node)
                         VALUES ($1, $2, $3)`,
                        [id, fromDbId, toDbId]
                    );
                } else {
                    console.warn('⚠️ No se pudo mapear conexión:', conn);
                }
            }
        }

        await client.query('COMMIT');

        // Devolver el gameplan actualizado usando la misma lógica que GET
        const gameplanResult = await client.query(`
            SELECT g.*, u.name AS creator_name
            FROM gameplans g
            LEFT JOIN users u ON g.user_id = u.id
            WHERE g.id = $1
        `, [id]);
        
        const gameplan = gameplanResult.rows[0];
        
        // Obtener nodos actualizados
        const nodesResult = await client.query(`
            SELECT id, technique_id, name, type, x, y
            FROM gameplan_nodes
            WHERE gameplan_id = $1
        `, [id]);
        
        // Obtener conexiones actualizadas
        const connectionsResult = await client.query(`
            SELECT id, from_node, to_node
            FROM gameplan_connections
            WHERE gameplan_id = $1
        `, [id]);
        
        // Combinar resultados
        const updatedGameplan = {
            ...gameplan,
            nodes: nodesResult.rows || [],
            connections: connectionsResult.rows || []
        };
        
        console.log('✅ Game Plan actualizado con éxito:');
        console.log('   ID:', updatedGameplan.id);
        console.log('   Nombre:', updatedGameplan.name);
        console.log('   Descripción:', updatedGameplan.description);
        console.log('   Nodos:', updatedGameplan.nodes.length);
        console.log('   Conexiones:', updatedGameplan.connections.length);

        res.json(updatedGameplan);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR actualizando game plan:', err);
        res.status(500).json({ 
            error: 'Error del servidor',
            message: err.message,
            details: err.stack
        });
    } finally {
        client.release();
    }
});

// Likes en comentarios
app.post('/api/comments/:id/like', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const likeCheck = await pool.query(
            'SELECT * FROM comment_likes WHERE user_id = $1 AND comment_id = $2',
            [req.user.id, id]
        );
        
        if (likeCheck.rows.length > 0) {
            await pool.query(
                'DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2',
                [req.user.id, id]
            );
            res.json({ liked: false });
        } else {
            await pool.query(
                'INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)',
                [req.user.id, id]
            );
            res.json({ liked: true });
        }
    } catch (err) {
        console.error('Error en like:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar comentarios (solo mestres o dueños)
app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar permisos
        const commentCheck = await pool.query(
            `SELECT c.*, g.user_id as gameplan_owner 
             FROM gameplan_comments c
             JOIN gameplans g ON c.gameplan_id = g.id
             WHERE c.id = $1`,
            [id]
        );
        
        if (commentCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Comentario no encontrado' });
        }
        
        const comment = commentCheck.rows[0];
        const canDelete = req.user.role === 'master' || 
                         comment.user_id === req.user.id || 
                         comment.gameplan_owner === req.user.id;
        
        if (!canDelete) {
            return res.status(403).json({ error: 'No tienes permisos para eliminar este comentario' });
        }
        
        await pool.query('DELETE FROM gameplan_comments WHERE id = $1', [id]);
        res.json({ message: 'Comentario eliminado' });
    } catch (err) {
        console.error('Error eliminando comentario:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

  app.delete('/api/gameplans/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM gameplans WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game Plan no encontrado' });
    }
    res.json({ message: 'Game Plan eliminado correctamente' });
  } catch (err) {
    console.error('Error eliminando game plan:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
  });

  app.post('/api/gameplans/:id/favorite', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const gameplanCheck = await pool.query(
      'SELECT * FROM gameplans WHERE id = $1',
      [id]
    );
    if (gameplanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Game Plan no encontrado' });
    }
    const favCheck = await pool.query(
      'SELECT * FROM gameplan_favorites WHERE user_id = $1 AND gameplan_id = $2',
      [req.user.id, id]
    );
    if (favCheck.rows.length > 0) {
      await pool.query(
        'DELETE FROM gameplan_favorites WHERE user_id = $1 AND gameplan_id = $2',
        [req.user.id, id]
      );
      return res.json({ favorite: false });
    } else {
      await pool.query(
        'INSERT INTO gameplan_favorites (user_id, gameplan_id) VALUES ($1, $2)',
        [req.user.id, id]
      );
      return res.json({ favorite: true });
    }
  } catch (err) {
    console.error('Error toggling favorito:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/gameplans/favorites', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, u.name AS creator_name,
             COALESCE(json_agg(DISTINCT n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS nodes,
             COALESCE(json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL), '[]') AS connections
      FROM gameplan_favorites f
      JOIN gameplans g ON f.gameplan_id = g.id
      LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
      LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
      LEFT JOIN users u ON g.user_id = u.id
      WHERE f.user_id = $1
      GROUP BY g.id, u.name, g.user_id  -- Added g.user_id to GROUP BY
      ORDER BY g.updated_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo favoritos:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/gameplans/:id/share', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        const gameplanCheck = await pool.query(
            'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        
        if (gameplanCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado o no eres el dueño' });
        }

        const userCheck = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario destino no encontrado' });
        }

        const shareCheck = await pool.query(
            'SELECT * FROM gameplan_shares WHERE gameplan_id = $1 AND to_user_id = $2', // ← CORREGIDO
            [id, userId]
        );
        
        if (shareCheck.rows.length > 0) {
            return res.json({ message: 'Game Plan ya compartido con este usuario' });
        }

        await pool.query(
            'INSERT INTO gameplan_shares (gameplan_id, from_user_id, to_user_id) VALUES ($1, $2, $3)', // ← CORREGIDO
            [id, req.user.id, userId]
        );
        
        res.json({ message: 'Game Plan compartido exitosamente' });
        
    } catch (err) {
        console.error('Error compartiendo game plan:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.get('/api/gameplans/shared', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT g.*, u.name AS creator_name,
                   COALESCE(json_agg(DISTINCT n.*) FILTER (WHERE n.id IS NOT NULL), '[]') AS nodes,
                   COALESCE(json_agg(DISTINCT c.*) FILTER (WHERE c.id IS NOT NULL), '[]') AS connections
            FROM gameplan_shares s
            JOIN gameplans g ON s.gameplan_id = g.id
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE s.to_user_id = $1  -- ← CORREGIDO: usar to_user_id en lugar de user_id
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo game plans compartidos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener sesiones de entrenamiento de un alumno específico (solo mestre)
app.get('/api/students/:id/gameplans', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const { id } = req.params;
    const sessions = await pool.query(
      'SELECT * FROM training_sessions WHERE user_id = $1 ORDER BY date DESC',
      [id]
    );
    res.json(sessions.rows);
  } catch (err) {
    console.error('Error obteniendo las sesiones del alumno:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// Marcar asistencia en un evento (p.ej., examen), crear evento (sólo por mestres, no implementado aquí)
app.post('/api/events/:id/attend', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('INSERT INTO events_attendance (user_id, event_id) VALUES ($1, $2)', [req.user.id, id]);
    res.status(201).json({ message: 'Asistencia registrada' });
  } catch (err) {
    console.error('Error registrando asistencia:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ==============================================
// OBTENER OBJETIVOS DE UN ALUMNO ESPECÍFICO (PARA MESTRES)
// ==============================================
app.get('/api/students/:id/objectives', authenticateToken, async (req, res) => {
    try {
        // Verificar que el usuario es mestre
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const studentId = req.params.id;
        
        console.log(`📥 Obteniendo objetivos del alumno ID: ${studentId}`);
        
        const result = await pool.query(`
            SELECT id, title, description, deadline, completed, completed_at, created_at, updated_at
            FROM user_objectives 
            WHERE user_id = $1 
            ORDER BY 
                completed ASC,
                deadline ASC NULLS LAST,
                created_at DESC
        `, [studentId]);

        console.log(`✅ ${result.rows.length} objetivos encontrados para alumno ${studentId}`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo objetivos del alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==============================================
// Obtener todos los planes disponibles
// ==============================================
app.get('/api/plans', authenticateToken, async (req, res) => {
    try {
        const plans = await pool.query(
            'SELECT id, name, code, max_students, max_instructors, can_export_reports, can_use_advanced_stats, can_send_bulk_messages, has_payment_system, has_api, price_monthly, features FROM plans WHERE is_active = true ORDER BY price_monthly'
        );
        res.json(plans.rows);
    } catch (error) {
        console.error('Error fetching plans:', error);
        res.status(500).json({ error: 'Error al obtener planes' });
    }
});

// ==============================================
// ESTADÍSTICAS DEL CLUB PARA GESTIÓN DE PLANES - CORREGIDA
// ==============================================

app.get('/api/club/stats/current', authenticateToken, async (req, res) => {
    try {
        // Obtener información del club
        const clubResult = await pool.query(`
            SELECT c.*, 
                   p.name as plan_name, 
                   p.code as plan_code,
                   p.max_students,
                   p.max_instructors,
                   p.can_export_reports,
                   p.can_use_advanced_stats,
                   p.can_send_bulk_messages,
                   p.has_payment_system,
                   p.has_api,
                   p.price_monthly,
                   cs.start_date as subscription_start,
                   cs.end_date as subscription_end,
                   cs.status as subscription_status
            FROM clubs c
            LEFT JOIN plans p ON c.current_plan_id = p.id
            LEFT JOIN club_subscriptions cs ON c.id = cs.club_id AND cs.status = 'active'
            WHERE c.id = $1
        `, [req.user.club_id]);
        
        // Contar alumnos activos (sin filtrar por status, solo role)
        const studentsCount = await pool.query(`
            SELECT COUNT(*) as count FROM users 
            WHERE club_id = $1 AND role = 'student'
        `, [req.user.club_id]);
        
        // Contar instructores (mestres)
        const instructorsCount = await pool.query(`
            SELECT COUNT(*) as count FROM users 
            WHERE club_id = $1 AND role = 'master'
        `, [req.user.club_id]);
        
        const club = clubResult.rows[0];
        
        if (!club) {
            return res.status(404).json({ error: 'Club no encontrado' });
        }
        
        res.json({
            club: {
                id: club.id,
                name: club.name,
                current_plan: club.current_plan_id ? {
                    id: club.current_plan_id,
                    name: club.plan_name,
                    code: club.plan_code,
                    max_students: club.max_students,
                    max_instructors: club.max_instructors,
                    features: {
                        can_export_reports: club.can_export_reports,
                        can_use_advanced_stats: club.can_use_advanced_stats,
                        can_send_bulk_messages: club.can_send_bulk_messages,
                        has_payment_system: club.has_payment_system,
                        has_api: club.has_api
                    },
                    price: club.price_monthly
                } : {
                    id: null,
                    name: 'Gratuito',
                    code: 'free',
                    max_students: 20,
                    max_instructors: 1,
                    features: {
                        can_export_reports: false,
                        can_use_advanced_stats: false,
                        can_send_bulk_messages: false,
                        has_payment_system: false,
                        has_api: false
                    },
                    price: 0
                },
                subscription: {
                    start_date: club.subscription_start,
                    end_date: club.subscription_end,
                    status: club.subscription_status || 'active'
                },
                stats: {
                    total_students: parseInt(studentsCount.rows[0]?.count || 0),
                    total_instructors: parseInt(instructorsCount.rows[0]?.count || 0)
                }
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo estadísticas del club:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// ==============================================
// OBTENER LÍMITES DEL PLAN ACTUAL
// ==============================================
app.get('/api/club/plan-limits', authenticateToken, async (req, res) => {
    try {
        // Obtener plan actual del club
        const result = await pool.query(`
            SELECT p.*, 
                   (SELECT COUNT(*) FROM users WHERE club_id = c.id AND role = 'student') as current_students,
                   (SELECT COUNT(*) FROM users WHERE club_id = c.id AND role = 'master') as current_instructors
            FROM clubs c
            JOIN plans p ON c.current_plan_id = p.id
            WHERE c.id = $1
        `, [req.user.club_id]);
        
        if (result.rows.length === 0) {
            return res.json({
                plan: {
                    code: 'free',
                    name: 'Gratuito',
                    max_students: 20,
                    max_instructors: 1,
                    can_export_reports: false,
                    can_use_advanced_stats: false,
                    has_payment_system: false
                },
                current_students: 0,
                current_instructors: 0,
                is_exceeded: false
            });
        }
        
        const data = result.rows[0];
        const isExceeded = data.current_students > data.max_students || 
                          data.current_instructors > data.max_instructors;
        
        res.json({
            plan: {
                id: data.id,
                code: data.code,
                name: data.name,
                max_students: data.max_students,
                max_instructors: data.max_instructors,
                can_export_reports: data.can_export_reports,
                can_use_advanced_stats: data.can_use_advanced_stats,
                has_payment_system: data.has_payment_system
            },
            current_students: parseInt(data.current_students || 0),
            current_instructors: parseInt(data.current_instructors || 0),
            is_exceeded: isExceeded,
            exceeded_type: data.current_students > data.max_students ? 'students' : 
                           (data.current_instructors > data.max_instructors ? 'instructors' : null)
        });
        
    } catch (error) {
        console.error('Error obteniendo límites del plan:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// GESTIÓN DE CAMBIOS PROGRAMADOS DE PLAN
// ==============================================

// Obtener información completa del plan (incluyendo cambios programados)
app.get('/api/club/plan-full-info', authenticateToken, async (req, res) => {
    try {
        // Obtener plan actual
        const currentPlan = await pool.query(`
            SELECT c.*, 
                   p.name as plan_name, p.code as plan_code, p.max_students, p.max_instructors,
                   p.can_export_reports, p.can_use_advanced_stats, p.has_payment_system,
                   c.subscription_end_date,
                   c.pending_plan_id,
                   c.pending_plan_start_date
            FROM clubs c
            LEFT JOIN plans p ON c.current_plan_id = p.id
            WHERE c.id = $1
        `, [req.user.club_id]);
        
        // Obtener información del plan pendiente si existe
        let pendingPlan = null;
        if (currentPlan.rows[0].pending_plan_id) {
            const pendingResult = await pool.query(`
                SELECT p.*, c.pending_plan_start_date as start_date
                FROM plans p
                JOIN clubs c ON c.pending_plan_id = p.id
                WHERE c.id = $1
            `, [req.user.club_id]);
            if (pendingResult.rows.length > 0) {
                pendingPlan = pendingResult.rows[0];
            }
        }
        
        // Contar alumnos e instructores actuales
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE club_id = $1 AND role = 'student') as students,
                (SELECT COUNT(*) FROM users WHERE club_id = $1 AND role = 'master') as instructors
        `, [req.user.club_id]);
        
        const club = currentPlan.rows[0];
        
        res.json({
            club: {
                id: club.id,
                name: club.name,
                current_plan: club.current_plan_id ? {
                    id: club.current_plan_id,
                    name: club.plan_name,
                    code: club.plan_code,
                    max_students: club.max_students,
                    max_instructors: club.max_instructors,
                    features: {
                        can_export_reports: club.can_export_reports,
                        can_use_advanced_stats: club.can_use_advanced_stats,
                        has_payment_system: club.has_payment_system
                    }
                } : null,
                subscription_end_date: club.subscription_end_date,
                pending_plan: pendingPlan ? {
                    id: pendingPlan.id,
                    name: pendingPlan.name,
                    code: pendingPlan.code,
                    start_date: pendingPlan.start_date
                } : null
            },
            stats: {
                students: parseInt(stats.rows[0]?.students || 0),
                instructors: parseInt(stats.rows[0]?.instructors || 0)
            }
        });
        
    } catch (error) {
        console.error('Error obteniendo info del plan:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Programar cambio de plan - VERSIÓN SIMPLIFICADA (SOLO MENSUAL)
app.post('/api/club/schedule-plan-change', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden cambiar el plan' });
        }
        
        const { plan_id } = req.body;
        
        // Obtener plan seleccionado
        const newPlanResult = await pool.query(
            'SELECT * FROM plans WHERE id = $1 AND is_active = true',
            [plan_id]
        );
        
        if (newPlanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan no encontrado' });
        }
        
        const newPlan = newPlanResult.rows[0];
        
        // Obtener información actual del club
        const clubResult = await pool.query(`
            SELECT c.*, p.code as current_plan_code, c.subscription_end_date
            FROM clubs c
            LEFT JOIN plans p ON c.current_plan_id = p.id
            WHERE c.id = $1
        `, [req.user.club_id]);
        
        const club = clubResult.rows[0];
        const now = new Date();
        const currentPlanCode = club.current_plan_code || 'free';
        const hasActiveSubscription = club.subscription_end_date && new Date(club.subscription_end_date) > now;
        const endDate = club.subscription_end_date ? new Date(club.subscription_end_date) : null;
        
        // ==========================================
        // LÓGICA DE DECISIÓN DE CAMBIO
        // ==========================================
        
        let isImmediate = false;
        let effectiveDate = null;
        let message = '';
        
        // Caso 1: De PLAN PAGO a GRATIS → PROGRAMADO (esperar 30 días)
        if (newPlan.code === 'free' && currentPlanCode !== 'free' && hasActiveSubscription) {
            isImmediate = false;
            effectiveDate = endDate;
            message = `Plan Gratuito programado para activarse el ${endDate.toLocaleDateString()}. Hasta entonces, seguirás con tu plan actual.`;
            
        // Caso 2: De GRATIS a PLAN PAGO → INMEDIATO
        } else if (newPlan.code !== 'free' && currentPlanCode === 'free') {
            isImmediate = true;
            const newEndDate = new Date();
            newEndDate.setMonth(newEndDate.getMonth() + 1);
            effectiveDate = newEndDate;
            message = `Plan ${newPlan.name} activado inmediatamente. Vigente hasta ${newEndDate.toLocaleDateString()}`;
            
        // Caso 3: De PLAN PAGO a PLAN PAGO → PROGRAMADO (esperar a que termine el actual)
        } else if (newPlan.code !== 'free' && currentPlanCode !== 'free' && hasActiveSubscription) {
            isImmediate = false;
            effectiveDate = endDate;
            message = `Plan ${newPlan.name} programado para activarse el ${endDate.toLocaleDateString()} cuando finalice tu plan actual.`;
            
        // Caso 4: Plan vencido o sin suscripción activa → INMEDIATO
        } else if (!hasActiveSubscription) {
            isImmediate = true;
            const newEndDate = new Date();
            newEndDate.setMonth(newEndDate.getMonth() + 1);
            effectiveDate = newEndDate;
            message = `Plan ${newPlan.name} activado inmediatamente. Vigente hasta ${newEndDate.toLocaleDateString()}`;
            
        // Caso por defecto: INMEDIATO
        } else {
            isImmediate = true;
            const newEndDate = new Date();
            newEndDate.setMonth(newEndDate.getMonth() + 1);
            effectiveDate = newEndDate;
            message = `Plan ${newPlan.name} activado inmediatamente.`;
        }
        
        console.log('📊 Decisión de cambio:', {
            currentPlan: currentPlanCode,
            newPlan: newPlan.code,
            hasActiveSubscription,
            isImmediate,
            effectiveDate,
            message
        });
        
        await client.query('BEGIN');
        
        if (isImmediate) {
            // CAMBIO INMEDIATO
            await client.query(`
                UPDATE clubs 
                SET current_plan_id = $1,
                    subscription_end_date = $2,
                    pending_plan_id = NULL,
                    pending_plan_start_date = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [plan_id, effectiveDate, req.user.club_id]);
            
            // Eliminar cambios pendientes anteriores
            await client.query(`
                DELETE FROM scheduled_plan_changes WHERE club_id = $1 AND status = 'pending'
            `, [req.user.club_id]);
            
            // Actualizar o insertar suscripción
            const existingSub = await client.query(
                'SELECT id FROM club_subscriptions WHERE club_id = $1',
                [req.user.club_id]
            );
            
            if (existingSub.rows.length > 0) {
                await client.query(`
                    UPDATE club_subscriptions 
                    SET plan_id = $1, 
                        status = 'active', 
                        start_date = CURRENT_TIMESTAMP, 
                        end_date = $2,
                        auto_renew = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE club_id = $3
                `, [plan_id, effectiveDate, req.user.club_id]);
            } else {
                await client.query(`
                    INSERT INTO club_subscriptions (club_id, plan_id, status, start_date, end_date, auto_renew)
                    VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, $3, true)
                `, [req.user.club_id, plan_id, effectiveDate]);
            }
            
        } else {
            // CAMBIO PROGRAMADO
            // Eliminar cambios pendientes anteriores
            await client.query(`
                DELETE FROM scheduled_plan_changes WHERE club_id = $1 AND status = 'pending'
            `, [req.user.club_id]);
            
            // Guardar cambio programado
            await client.query(`
                INSERT INTO scheduled_plan_changes (club_id, current_plan_id, new_plan_id, effective_date, status)
                VALUES ($1, $2, $3, $4, 'pending')
            `, [req.user.club_id, club.current_plan_id, plan_id, effectiveDate]);
            
            // Actualizar club con plan pendiente
            await client.query(`
                UPDATE clubs 
                SET pending_plan_id = $1,
                    pending_plan_start_date = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [plan_id, effectiveDate, req.user.club_id]);
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: message,
            immediate: isImmediate,
            scheduled: !isImmediate,
            effective_date: effectiveDate,
            days_left: effectiveDate ? Math.ceil((effectiveDate - now) / (1000 * 60 * 60 * 24)) : 0
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error programando cambio de plan:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    } finally {
        client.release();
    }
});

// Cancelar cambio programado
app.post('/api/club/cancel-scheduled-change', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden cancelar cambios' });
        }
        
        // Eliminar cambios pendientes
        await pool.query(`
            DELETE FROM scheduled_plan_changes 
            WHERE club_id = $1 AND status = 'pending'
        `, [req.user.club_id]);
        
        // Limpiar club
        await pool.query(`
            UPDATE clubs 
            SET pending_plan_id = NULL,
                pending_plan_start_date = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [req.user.club_id]);
        
        res.json({ success: true, message: 'Cambio programado cancelado' });
        
    } catch (error) {
        console.error('Error cancelando cambio:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Aplicar cambios programados (para CRON job)
app.post('/api/admin/apply-scheduled-changes', async (req, res) => {
    // Esta ruta debería ser protegida con API key en producción
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const pendingChanges = await pool.query(`
            SELECT sc.*, c.name as club_name
            FROM scheduled_plan_changes sc
            JOIN clubs c ON sc.club_id = c.id
            WHERE sc.status = 'pending' AND sc.effective_date <= $1
        `, [today]);
        
        for (const change of pendingChanges.rows) {
            await pool.query('BEGIN');
            
            // Calcular nueva fecha de fin (1 mes después)
            const newEndDate = new Date();
            newEndDate.setMonth(newEndDate.getMonth() + 1);
            
            // Actualizar club
            await pool.query(`
                UPDATE clubs 
                SET current_plan_id = $1,
                    subscription_end_date = $2,
                    pending_plan_id = NULL,
                    pending_plan_start_date = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [change.new_plan_id, newEndDate, change.club_id]);
            
            // Verificar si existe suscripción
            const existingSub = await pool.query(
                'SELECT id FROM club_subscriptions WHERE club_id = $1',
                [change.club_id]
            );
            
            if (existingSub.rows.length > 0) {
                // Actualizar existente
                await pool.query(`
                    UPDATE club_subscriptions 
                    SET plan_id = $1, 
                        status = 'active', 
                        start_date = CURRENT_TIMESTAMP, 
                        end_date = $2,
                        auto_renew = true,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE club_id = $3
                `, [change.new_plan_id, newEndDate, change.club_id]);
            } else {
                // Insertar nueva
                await pool.query(`
                    INSERT INTO club_subscriptions (club_id, plan_id, status, start_date, end_date, auto_renew)
                    VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, $3, true)
                `, [change.club_id, change.new_plan_id, newEndDate]);
            }
            
            // Marcar cambio como aplicado
            await pool.query(`
                UPDATE scheduled_plan_changes 
                SET status = 'applied', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [change.id]);
            
            await pool.query('COMMIT');
            console.log(`✅ Plan cambiado para club ${change.club_name} a ${change.new_plan_id}`);
        }
        
        res.json({ 
            success: true, 
            applied: pendingChanges.rows.length,
            message: `${pendingChanges.rows.length} cambios aplicados`
        });
        
    } catch (error) {
        console.error('Error aplicando cambios programados:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cambiar plan (con validación de fechas)
app.post('/api/club/change-plan', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden cambiar el plan' });
        }
        
        const { plan_id, isYearly } = req.body;
        
        // Obtener plan seleccionado
        const planResult = await pool.query(
            'SELECT * FROM plans WHERE id = $1 AND is_active = true',
            [plan_id]
        );
        
        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan no encontrado' });
        }
        
        const newPlan = planResult.rows[0];
        
        // Obtener suscripción actual
        const currentSub = await client.query(`
            SELECT cs.*, p.code as plan_code
            FROM club_subscriptions cs
            JOIN plans p ON cs.plan_id = p.id
            WHERE cs.club_id = $1 AND cs.status = 'active'
        `, [req.user.club_id]);
        
        const now = new Date();
        let startDate = now;
        let endDate = new Date(now);
        
        if (isYearly) {
            endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }
        
        await client.query('BEGIN');
        
        // Si hay suscripción activa, finalizarla
        if (currentSub.rows.length > 0) {
            const currentPlan = currentSub.rows[0];
            
            // Si es el mismo plan, no hacer nada
            if (currentPlan.plan_id === plan_id) {
                return res.json({ message: 'Ya estás en este plan' });
            }
            
            // Si el plan actual es free y se quiere cambiar a otro, iniciar nuevo plan
            // Si el plan actual es pago y se quiere cambiar, programar para cuando termine
            if (currentPlan.plan_code === 'free') {
                // Cambio inmediato
                startDate = now;
            } else {
                // Programar para cuando termine la suscripción actual
                startDate = new Date(currentPlan.end_date);
                endDate = new Date(startDate);
                if (isYearly) {
                    endDate.setFullYear(endDate.getFullYear() + 1);
                } else {
                    endDate.setMonth(endDate.getMonth() + 1);
                }
            }
            
            // Finalizar suscripción actual
            await client.query(`
                UPDATE club_subscriptions 
                SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [currentPlan.id]);
        }
        
        // Crear nueva suscripción
        const newSubscription = await client.query(`
            INSERT INTO club_subscriptions 
            (club_id, plan_id, status, start_date, end_date, auto_renew, payment_method)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [req.user.club_id, plan_id, 'active', startDate, endDate, true, 'system']);
        
        // Actualizar club con el nuevo plan
        await client.query(`
            UPDATE clubs 
            SET current_plan_id = $1,
                subscription_status = 'active',
                subscription_start_date = $2,
                subscription_end_date = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [plan_id, startDate, endDate, req.user.club_id]);
        
        await client.query('COMMIT');
        
        const startDateStr = startDate.toLocaleDateString('es-ES');
        const endDateStr = endDate.toLocaleDateString('es-ES');
        
        let message = '';
        if (currentSub.rows.length > 0 && currentSub.rows[0].plan_code !== 'free') {
            message = `Plan programado para iniciar el ${startDateStr}. Tu plan actual sigue activo hasta esa fecha.`;
        } else {
            message = `Plan ${newPlan.name} activado correctamente. Vigencia: ${startDateStr} al ${endDateStr}`;
        }
        
        res.json({
            success: true,
            message: message,
            subscription: newSubscription.rows[0],
            plan: newPlan,
            start_date: startDate,
            end_date: endDate
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error cambiando plan:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    } finally {
        client.release();
    }
});

// ==============================================
// Obtener suscripción actual del club
// ==============================================
app.get('/api/club/subscription', authenticateToken, async (req, res) => {
    try {
        // Obtener el club del usuario
        const userClub = await pool.query(
            'SELECT club_id FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (!userClub.rows[0]) {
            return res.status(404).json({ error: 'Club no encontrado' });
        }
        
        const clubId = userClub.rows[0].club_id;
        
        // Obtener suscripción activa
        const subscription = await pool.query(`
            SELECT cs.*, p.name as plan_name, p.code as plan_code, p.max_students, 
                   p.max_instructors, p.can_export_reports, p.can_use_advanced_stats,
                   p.can_send_bulk_messages, p.has_payment_system, p.has_api, p.price_monthly
            FROM club_subscriptions cs
            JOIN plans p ON cs.plan_id = p.id
            WHERE cs.club_id = $1 AND cs.status = 'active'
            ORDER BY cs.start_date DESC LIMIT 1
        `, [clubId]);
        
        if (subscription.rows.length === 0) {
            // Si no hay suscripción activa, devolver plan free por defecto
            const freePlan = await pool.query(
                'SELECT * FROM plans WHERE code = $1',
                ['free']
            );
            
            return res.json({
                plan: freePlan.rows[0],
                status: 'trial',
                message: 'Sin suscripción activa'
            });
        }
        
        res.json({
            subscription: subscription.rows[0],
            plan: {
                id: subscription.rows[0].plan_id,
                name: subscription.rows[0].plan_name,
                code: subscription.rows[0].plan_code,
                max_students: subscription.rows[0].max_students,
                max_instructors: subscription.rows[0].max_instructors,
                features: {
                    canExportReports: subscription.rows[0].can_export_reports,
                    canUseAdvancedStats: subscription.rows[0].can_use_advanced_stats,
                    canSendBulkMessages: subscription.rows[0].can_send_bulk_messages,
                    hasPaymentSystem: subscription.rows[0].has_payment_system,
                    hasApi: subscription.rows[0].has_api
                },
                price: subscription.rows[0].price_monthly
            },
            status: subscription.rows[0].status,
            startDate: subscription.rows[0].start_date,
            endDate: subscription.rows[0].end_date
        });
        
    } catch (error) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ error: 'Error al obtener suscripción' });
    }
});

// ==============================================
// OBTENER TODOS LOS CLUBS PARA EL SELECT
// ==============================================
app.get('/api/clubs', async (req, res) => {
    try {
        const clubs = await pool.query(
            `SELECT id, name, 
                    (SELECT COUNT(*) FROM users WHERE club_id = clubs.id) as member_count
             FROM clubs 
             ORDER BY name`
        );
        res.json(clubs.rows);
    } catch (error) {
        console.error('Error fetching clubs:', error);
        res.status(500).json({ error: 'Error al obtener clubs' });
    }
});

// ==============================================
// OBTENER DETALLE DE UN CLUB ESPECÍFICO
// ==============================================
app.get('/api/clubs/:id', authenticateToken, async (req, res) => {
    try {
        const club = await pool.query(
            `SELECT c.*, 
                    p.name as plan_name,
                    p.code as plan_code,
                    (SELECT COUNT(*) FROM users WHERE club_id = c.id) as total_members,
                    (SELECT COUNT(*) FROM students WHERE club_id = c.id) as total_students
             FROM clubs c
             LEFT JOIN plans p ON c.current_plan_id = p.id
             WHERE c.id = $1`,
            [req.params.id]
        );
        
        if (club.rows.length === 0) {
            return res.status(404).json({ error: 'Club no encontrado' });
        }
        
        res.json(club.rows[0]);
    } catch (error) {
        console.error('Error fetching club:', error);
        res.status(500).json({ error: 'Error al obtener club' });
    }
});

// ==============================================
// Seleccionar/Cambiar plan (simulación de pago)
// ==============================================
app.post('/api/club/select-plan', authenticateToken, async (req, res) => {
    const { planId, isYearly } = req.body;
    
    try {
        // Obtener el club del usuario
        const userClub = await pool.query(
            'SELECT club_id FROM users WHERE id = $1',
            [req.user.id]
        );
        
        const clubId = userClub.rows[0].club_id;
        
        // Obtener el plan seleccionado
        const plan = await pool.query(
            'SELECT * FROM plans WHERE id = $1',
            [planId]
        );
        
        if (plan.rows.length === 0) {
            return res.status(404).json({ error: 'Plan no encontrado' });
        }
        
        // Guardar historial del plan anterior
        const currentSubscription = await pool.query(
            'SELECT * FROM club_subscriptions WHERE club_id = $1 AND status = $2',
            [clubId, 'active']
        );
        
        if (currentSubscription.rows.length > 0) {
            // Actualizar suscripción anterior a expirada
            await pool.query(
                `UPDATE club_subscriptions 
                 SET status = 'expired', end_date = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [currentSubscription.rows[0].id]
            );
            
            // Guardar en historial del club
            await pool.query(
                `UPDATE clubs 
                 SET plan_history = plan_history || $1::jsonb
                 WHERE id = $2`,
                [JSON.stringify([{
                    plan_id: currentSubscription.rows[0].plan_id,
                    from: currentSubscription.rows[0].start_date,
                    to: new Date(),
                    status: 'expired'
                }]), clubId]
            );
        }
        
        // Crear nueva suscripción
        const price = isYearly ? plan.rows[0].price_yearly : plan.rows[0].price_monthly;
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + (isYearly ? 12 : 1));
        
        const newSubscription = await pool.query(
            `INSERT INTO club_subscriptions 
             (club_id, plan_id, status, start_date, end_date, auto_renew, payment_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [clubId, planId, 'active', startDate, endDate, true, 'simulated']
        );
        
        // Actualizar club
        await pool.query(
            `UPDATE clubs 
             SET current_plan_id = $1,
                 subscription_status = 'active',
                 subscription_start_date = $2,
                 subscription_end_date = $3
             WHERE id = $4`,
            [planId, startDate, endDate, clubId]
        );
        
        // SIMULACIÓN: Aquí iría la integración con pasarela de pago
        // Crear registro de pago simulado
        await pool.query(
            `INSERT INTO payments 
             (club_id, subscription_id, amount, status, payment_method, period_start, period_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [clubId, newSubscription.rows[0].id, price, 'completed', 'simulated', startDate, endDate]
        );
        
        res.json({
            success: true,
            message: `Plan ${plan.rows[0].name} activado correctamente`,
            plan: plan.rows[0],
            endDate
        });
        
    } catch (error) {
        console.error('Error selecting plan:', error);
        res.status(500).json({ error: 'Error al seleccionar plan' });
    }
});

// ==============================================
// SISTEMA DE MEMBRESÍAS Y PAGOS
// ==============================================

// Obtener configuración de la academia
app.get('/api/academy/settings', authenticateToken, async (req, res) => {
    try {
        console.log('📥 Obteniendo configuración para club:', req.user.club_id);
        
        const result = await pool.query(
            `SELECT a.*, u.name as updated_by_name
             FROM academy_settings a
             LEFT JOIN users u ON a.updated_by = u.id
             WHERE a.club_id = $1`,
            [req.user.club_id]
        );
        
        if (result.rows.length === 0) {
            const clubResult = await pool.query(
                'SELECT name FROM clubs WHERE id = $1',
                [req.user.club_id]
            );
            
            const newSettings = await pool.query(
                `INSERT INTO academy_settings (club_id, academy_name) 
                 VALUES ($1, $2) RETURNING *`,
                [req.user.club_id, clubResult.rows[0]?.name || 'Mi Academia']
            );
            
            return res.json(newSettings.rows[0]);
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Actualizar configuración de la academia
app.put('/api/academy/settings', authenticateToken, async (req, res) => {
    try {
        const { academy_name, address, phone, email, website, logo_url } = req.body;
        
        console.log('📝 Guardando configuración de academia:', { 
            club_id: req.user.club_id,
            academy_name, 
            address, 
            phone, 
            email, 
            website 
        });
        
        const existing = await pool.query(
            'SELECT id FROM academy_settings WHERE club_id = $1',
            [req.user.club_id]
        );
        
        let result;
        
        if (existing.rows.length > 0) {
            result = await pool.query(
                `UPDATE academy_settings 
                 SET academy_name = COALESCE($1, academy_name),
                     address = COALESCE($2, address),
                     phone = COALESCE($3, phone),
                     email = COALESCE($4, email),
                     website = COALESCE($5, website),
                     logo_url = COALESCE($6, logo_url),
                     updated_at = CURRENT_TIMESTAMP,
                     updated_by = $7
                 WHERE club_id = $8
                 RETURNING *`,
                [academy_name, address, phone, email, website, logo_url, req.user.id, req.user.club_id]
            );
        } else {
            result = await pool.query(
                `INSERT INTO academy_settings 
                 (club_id, academy_name, address, phone, email, website, logo_url, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [req.user.club_id, academy_name, address, phone, email, website, logo_url, req.user.id]
            );
        }
        
        console.log('✅ Configuración guardada:', result.rows[0]);
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Obtener todos los mestres del club - VERSIÓN CORREGIDA
app.get('/api/academy/masters', authenticateToken, async (req, res) => {
    try {
        console.log('👥 Obteniendo mestres para club:', req.user.club_id);
        
        const result = await pool.query(
            `SELECT id, name, email, belt, phone, created_at
             FROM users 
             WHERE club_id = $1 AND role = 'master'
             ORDER BY name`,
            [req.user.club_id]
        );
        
        console.log(`✅ ${result.rows.length} mestres encontrados`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo mestres:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener planes de membresía del club
app.get('/api/membership/plans', authenticateToken, async (req, res) => {
    try {
        console.log('📦 Obteniendo planes para club:', req.user.club_id);
        
        const result = await pool.query(
            `SELECT * FROM membership_plans 
             WHERE club_id = $1 AND is_active = true
             ORDER BY price`,
            [req.user.club_id]
        );
        
        console.log(`✅ ${result.rows.length} planes encontrados`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear/actualizar plan de membresía
app.post('/api/membership/plans', authenticateToken, async (req, res) => {
    try {
        console.log('📝 Recibida petición para plan');
        
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden gestionar planes' });
        }

        if (!req.user.club_id) {
            return res.status(400).json({ error: 'Usuario no tiene club asignado' });
        }

        const { id, name, description, price, days_per_week, class_limit } = req.body;
        
        if (!name || !price) {
            return res.status(400).json({ error: 'Nombre y precio son requeridos' });
        }

        let result;
        
        if (id) {
            const planCheck = await pool.query(
                'SELECT * FROM membership_plans WHERE id = $1 AND club_id = $2',
                [id, req.user.club_id]
            );
            
            if (planCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Plan no encontrado' });
            }
            
            result = await pool.query(
                `UPDATE membership_plans 
                 SET name = $1, description = $2, price = $3, 
                     days_per_week = $4, class_limit = $5,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $6 AND club_id = $7
                 RETURNING *`,
                [name, description, price, days_per_week, class_limit, id, req.user.club_id]
            );
            
        } else {
            const existingPlan = await pool.query(
                'SELECT id FROM membership_plans WHERE club_id = $1 AND name = $2 AND is_active = true',
                [req.user.club_id, name]
            );
            
            if (existingPlan.rows.length > 0) {
                return res.status(400).json({ error: 'Ya existe un plan con ese nombre' });
            }
            
            result = await pool.query(
                `INSERT INTO membership_plans 
                 (club_id, name, description, price, days_per_week, class_limit)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [req.user.club_id, name, description || '', price, days_per_week || null, class_limit || null]
            );
        }
        
        res.status(200).json(result.rows[0]);
        
    } catch (error) {
        console.error('❌ Error guardando plan:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Eliminar plan de membresía (soft delete)
app.delete('/api/membership/plans/:id', authenticateToken, async (req, res) => {
    try {
        console.log('🗑️ Eliminando plan:', req.params.id);
        
        await pool.query(
            'UPDATE membership_plans SET is_active = false WHERE id = $1 AND club_id = $2',
            [req.params.id, req.user.club_id]
        );
        
        res.json({ message: 'Plan eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando plan:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// OBTENER MEMBRESÍA DE UN ALUMNO
// ==============================================
app.get('/api/students/:id/membership', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        const result = await pool.query(`
            SELECT 
                m.*,
                mp.name as plan_name,
                mp.price,
                mp.days_per_week,
                mp.class_limit,
                (
                    SELECT payment_date 
                    FROM payments 
                    WHERE user_id = $1 
                    ORDER BY payment_date DESC 
                    LIMIT 1
                ) as last_payment_date,
                (
                    SELECT period_end 
                    FROM payments 
                    WHERE user_id = $1 
                    ORDER BY payment_date DESC 
                    LIMIT 1
                ) as current_period_end,
                (
                    SELECT COUNT(*) 
                    FROM payments 
                    WHERE user_id = $1
                ) as total_payments
            FROM members m
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE m.user_id = $1
        `, [studentId]);
        
        if (result.rows.length === 0) {
            // No tiene membresía activa
            return res.json(null);
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Error obteniendo membresía:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Registrar nuevo pago - VERSIÓN CON GENERACIÓN AUTOMÁTICA DE COMPROBANTE
app.post('/api/students/:id/payments', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden registrar pagos' });
        }
        
        const studentId = req.params.id;
        const { membership_plan_id, amount, payment_method, period_start, period_end, notes } = req.body;
        
        console.log('💰 Registrando pago:', { studentId, amount, payment_method, period_start, period_end });

        await client.query('BEGIN');

        // Verificar o crear membresía
        let memberResult = await client.query(
            'SELECT id FROM members WHERE user_id = $1',
            [studentId]
        );
        
        let memberId;
        if (memberResult.rows.length === 0) {
            // Crear nueva membresía
            const newMember = await client.query(
                `INSERT INTO members (user_id, club_id, membership_plan_id, status, start_date, end_date)
                 VALUES ($1, $2, $3, 'active', $4, $5)
                 RETURNING id`,
                [studentId, req.user.club_id, membership_plan_id, period_start, period_end]
            );
            memberId = newMember.rows[0].id;
        } else {
            memberId = memberResult.rows[0].id;
            // Actualizar membresía existente
            await client.query(
                `UPDATE members 
                 SET membership_plan_id = $1, status = 'active', 
                     start_date = $2, end_date = $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [membership_plan_id, period_start, period_end, memberId]
            );
        }
        
        // Registrar pago
        const paymentResult = await client.query(
            `INSERT INTO payments 
             (user_id, club_id, amount, payment_method, period_start, period_end, notes, registered_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [studentId, req.user.club_id, amount, payment_method, period_start, period_end, notes || null, req.user.id]
        );
        
        const payment = paymentResult.rows[0];
        
        // 🔥 GENERAR COMPROBANTE AUTOMÁTICAMENTE
        await generatePaymentReceipt(client, payment, req.user.club_id);
        
        // 🔥 CREAR NOTIFICACIONES
        await createPaymentNotification(payment.id);
        
        await client.query('COMMIT');
        
        // Obtener el comprobante generado
        const receiptResult = await client.query(
            'SELECT * FROM payment_receipts WHERE payment_id = $1',
            [payment.id]
        );
        
        res.status(201).json({
            message: 'Pago registrado correctamente',
            payment: payment,
            receipt: receiptResult.rows[0] || null,
            member_id: memberId
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error registrando pago:', error);
        res.status(500).json({ error: 'Error al registrar pago: ' + error.message });
    } finally {
        client.release();
    }
});

// ==============================================
// FUNCIÓN PARA GENERAR COMPROBANTE DE PAGO - VERSIÓN CORREGIDA
// ==============================================
async function generatePaymentReceipt(client, payment, clubId) {
    try {
        console.log('📄 Generando comprobante para pago:', payment.id);
        
        // Obtener datos completos para el comprobante - SIN c.address
        const data = await client.query(`
            SELECT 
                p.*,
                u.id as user_id, u.name as user_name, u.email, u.belt,
                mp.name as plan_name, mp.price,
                c.name as club_name, c.phone as club_phone
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON p.club_id = c.id
            WHERE p.id = $1
        `, [payment.id]);
        
        if (data.rows.length === 0) {
            throw new Error('No se encontraron datos del pago');
        }
        
        const paymentData = data.rows[0];
        
        // Generar HTML del comprobante (sin address)
        const receiptHTML = generateReceiptHTML(paymentData);
        
        // Guardar en base de datos
        await client.query(
            `INSERT INTO payment_receipts 
             (payment_id, user_id, club_id, pdf_data)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [payment.id, paymentData.user_id, clubId, receiptHTML]
        );
        
        console.log('✅ Comprobante generado para pago:', payment.id);
        
    } catch (error) {
        console.error('Error generando comprobante:', error);
        // No hacer throw para no interrumpir el flujo principal
    }
}

// ==============================================
// DESCARGAR COMPROBANTE EN PDF
// ==============================================
app.get('/api/receipts/:id/pdf', authenticateToken, async (req, res) => {
    try {
        const receiptId = req.params.id;
        
        // Obtener datos del comprobante
        const receiptData = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   p.payment_method,
                   u.name as user_name, u.email, u.belt,
                   mp.name as plan_name,
                   c.name as club_name, c.phone as club_phone
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON r.club_id = c.id
            WHERE r.id = $1
        `, [receiptId]);
        
        if (receiptData.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }
        
        const data = receiptData.rows[0];
        
        // Generar HTML
        const html = generateReceiptHTML(data);
        
        // Generar PDF
        const pdfBuffer = await generatePDF(html);
        
        // Configurar headers para descarga de PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=comprobante-${data.receipt_number || receiptId}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
        
    } catch (error) {
        console.error('Error generando PDF:', error);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});

// ==============================================
// Ruta alternativa con token en URL (para ventanas emergentes)
// ==============================================
app.get('/api/receipts/:id/preview-token', async (req, res) => {
    try {
        const receiptId = req.params.id;
        const token = req.query.token;
        
        if (!token) {
            return res.status(401).json({ error: 'Token requerido' });
        }
        
        // Verificar token manualmente
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }
        
        // Verificar usuario
        const userResult = await pool.query(
            'SELECT id, club_id FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener datos del comprobante
        const receiptData = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   p.payment_method,
                   u.name as user_name, u.email, u.belt,
                   mp.name as plan_name,
                   c.name as club_name, c.phone as club_phone
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON r.club_id = c.id
            WHERE r.id = $1
        `, [receiptId]);
        
        if (receiptData.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }
        
        const data = receiptData.rows[0];
        
        // Generar HTML
        const html = generateReceiptHTML(data);
        
        // Enviar HTML
        res.send(html);
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.get('/api/receipts/:id/pdf-token', async (req, res) => {
    try {
        const receiptId = req.params.id;
        const token = req.query.token;
        
        if (!token) {
            return res.status(401).json({ error: 'Token requerido' });
        }
        
        // Verificar token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }
        
        // Verificar usuario
        const userResult = await pool.query(
            'SELECT id, club_id FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener datos del comprobante
        const receiptData = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   p.payment_method,
                   u.name as user_name, u.email, u.belt,
                   mp.name as plan_name,
                   c.name as club_name, c.phone as club_phone
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON r.club_id = c.id
            WHERE r.id = $1
        `, [receiptId]);
        
        if (receiptData.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }
        
        const data = receiptData.rows[0];
        
        // Generar HTML
        const html = generateReceiptHTML(data);
        
        // Generar PDF
        const pdfBuffer = await generatePDF(html);
        
        // Configurar headers para descarga de PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=comprobante-${data.receipt_number || receiptId}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
        
    } catch (error) {
        console.error('Error generando PDF:', error);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});

// Obtener historial de pagos de un alumno
app.get('/api/students/:id/payments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, mp.name as plan_name, u.name as registered_by_name
             FROM payments p
             LEFT JOIN members m ON p.user_id = m.user_id
             LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
             LEFT JOIN users u ON p.registered_by = u.id
             WHERE p.user_id = $1
             ORDER BY p.payment_date DESC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo pagos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener ingresos mensuales del club
app.get('/api/club/revenue', authenticateToken, async (req, res) => {
    try {
        const { year, month } = req.query;
        
        let query = `
            SELECT 
                EXTRACT(YEAR FROM payment_date) as year,
                EXTRACT(MONTH FROM payment_date) as month,
                COUNT(*) as payment_count,
                SUM(amount) as total_revenue
            FROM payments
            WHERE club_id = $1
        `;
        const params = [req.user.club_id];
        
        if (year) {
            query += ` AND EXTRACT(YEAR FROM payment_date) = $2`;
            params.push(year);
        }
        
        if (month) {
            query += ` AND EXTRACT(MONTH FROM payment_date) = $3`;
            params.push(month);
        }
        
        query += ` GROUP BY year, month ORDER BY year DESC, month DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo ingresos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// Verificar límites del plan
// ==============================================
app.get('/api/club/check-limit/:limitType', authenticateToken, async (req, res) => {
    const { limitType } = req.params;
    
    try {
        // Obtener club_id del usuario
        const userResult = await pool.query(
            'SELECT club_id FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (userResult.rows.length === 0 || !userResult.rows[0].club_id) {
            return res.status(404).json({ error: 'Usuario no tiene club asignado' });
        }
        
        const clubId = userResult.rows[0].club_id;
        
        // Obtener club y su plan
        const clubData = await pool.query(`
            SELECT c.*, p.*, 
                   (SELECT COUNT(*) FROM students WHERE club_id = c.id) as total_students,
                   (SELECT COUNT(*) FROM users WHERE club_id = c.id AND role = 'instructor') as total_instructors
            FROM clubs c
            JOIN plans p ON c.current_plan_id = p.id
            WHERE c.id = $1
        `, [clubId]);
        
        if (clubData.rows.length === 0) {
            return res.status(404).json({ error: 'Club no encontrado' });
        }
        
        const club = clubData.rows[0];
        let limit = 0;
        let current = 0;
        let canProceed = true;
        
        switch(limitType) {
            case 'students':
                limit = club.max_students;
                current = parseInt(club.total_students || 0);
                canProceed = current < limit;
                break;
            case 'instructors':
                limit = club.max_instructors;
                current = parseInt(club.total_instructors || 0);
                canProceed = current < limit;
                break;
            case 'export_reports':
                canProceed = club.can_export_reports;
                break;
            case 'advanced_stats':
                canProceed = club.can_use_advanced_stats;
                break;
            case 'bulk_messages':
                canProceed = club.can_send_bulk_messages;
                break;
            case 'api':
                canProceed = club.has_api;
                break;
            default:
                canProceed = true;
        }
        
        res.json({
            canProceed,
            limit,
            current,
            plan: club.code,
            planName: club.name,
            message: canProceed ? 'Límite válido' : `Has alcanzado el límite de ${limitType}`
        });
        
    } catch (error) {
        console.error('Error checking limit:', error);
        res.status(500).json({ error: 'Error al verificar límites' });
    }
});

// ==============================================
// Generar QR para alumno
// ==============================================
app.post('/api/students/:id/generate-qr', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        // Verificar permisos (solo mestre del club)
        const student = await pool.query(
            `SELECT s.*, u.club_id 
             FROM students s
             JOIN users u ON s.user_id = u.id
             WHERE s.id = $1`,
            [studentId]
        );
        
        if (student.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }
        
        // Verificar que el mestre pertenece al mismo club
        const userClub = await pool.query(
            'SELECT club_id FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (userClub.rows[0].club_id !== student.rows[0].club_id) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        
        // Generar código QR único
        const crypto = require('crypto');
        const qrCode = crypto.randomBytes(32).toString('hex');
        
        // Aquí generarías la imagen QR (usando librería como qrcode)
        // const qrImage = await generateQRCode(qrCode);
        const qrImage = `data:image/png;base64,${Buffer.from(qrCode).toString('base64')}`;
        
        // Guardar en base de datos
        const result = await pool.query(
            `INSERT INTO attendance_qr_codes 
             (student_id, qr_code, qr_image, expires_at)
             VALUES ($1, $2, $3, $4)
             RETURNING id, qr_image`,
            [studentId, qrCode, qrImage, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)] // 1 año
        );
        
        // Actualizar student con referencia al QR
        await pool.query(
            'UPDATE students SET qr_code_id = $1 WHERE id = $2',
            [result.rows[0].id, studentId]
        );
        
        res.json({
            success: true,
            qrImage: result.rows[0].qr_image,
            qrCode: qrCode,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });
        
    } catch (error) {
        console.error('Error generating QR:', error);
        res.status(500).json({ error: 'Error al generar código QR' });
    }
});

// ==============================================
// Registrar asistencia por QR
// ==============================================
app.post('/api/attendance/register', authenticateToken, async (req, res) => {
    const { studentId, qrCode, timestamp } = req.body;
    
    try {
        // Verificar QR válido
        const qrData = await pool.query(
            `SELECT * FROM attendance_qr_codes 
             WHERE student_id = $1 AND qr_code = $2 AND is_active = true 
             AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
            [studentId, qrCode]
        );
        
        if (qrData.rows.length === 0) {
            return res.status(400).json({ error: 'QR inválido o expirado' });
        }
        
        // Registrar asistencia
        await pool.query(
            `INSERT INTO attendance_records 
             (student_id, scanned_by, scan_method, created_at)
             VALUES ($1, $2, $3, $4)`,
            [studentId, req.user.id, 'qr', new Date(timestamp)]
        );
        
        // Actualizar última asistencia del alumno
        await pool.query(
            `UPDATE students 
             SET last_attendance = $1,
                 total_sessions = total_sessions + 1
             WHERE id = $2`,
            [new Date(timestamp), studentId]
        );
        
        res.json({ success: true, message: 'Asistencia registrada' });
        
    } catch (error) {
        console.error('Error registering attendance:', error);
        res.status(500).json({ error: 'Error al registrar asistencia' });
    }
});

// ==============================================
// Obtener estadísticas del club - VERSIÓN CORREGIDA
// ==============================================
app.get('/api/club/stats', authenticateToken, async (req, res) => {
    try {
        // Obtener el club_id del usuario
        const userResult = await pool.query(
            'SELECT club_id FROM users WHERE id = $1',
            [req.user.id]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].club_id) {
            return res.status(404).json({ error: 'Usuario no tiene club asignado' });
        }

        const clubId = userResult.rows[0].club_id;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        // 1. 📊 RETENCIÓN DE ALUMNOS (últimos 6 meses)
        const retention = await pool.query(`
            WITH months AS (
                SELECT generate_series(
                    date_trunc('month', $1::date),
                    date_trunc('month', CURRENT_DATE),
                    '1 month'::interval
                ) as month
            )
            SELECT 
                to_char(months.month, 'YYYY-MM') as label,
                COUNT(DISTINCT u.id) as total_students
            FROM months
            LEFT JOIN users u ON 
                date_trunc('month', u.created_at) <= months.month + interval '1 month'
                AND u.role = 'student'
                AND u.club_id = $2
            GROUP BY months.month
            ORDER BY months.month
        `, [sixMonthsAgo, clubId]);

        // 2. 📈 TASA DE ASISTENCIA POR DÍA DE LA SEMANA
        const attendanceByDay = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM ts.date) as day_of_week,
                COUNT(*) as session_count,
                ROUND(AVG(ts.rating), 1) as avg_rating
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE u.club_id = $1
                AND ts.date >= $2
            GROUP BY day_of_week
            ORDER BY day_of_week
        `, [clubId, startOfMonth]);

        // 3. 🥋 PROGRESIÓN DE CINTURONES
        const beltProgression = await pool.query(`
            SELECT 
                belt,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percentage
            FROM users
            WHERE club_id = $1 AND role = 'student'
            GROUP BY belt
            ORDER BY 
                CASE belt
                    WHEN 'white' THEN 1
                    WHEN 'blue' THEN 2
                    WHEN 'purple' THEN 3
                    WHEN 'brown' THEN 4
                    WHEN 'black' THEN 5
                    ELSE 6
                END
        `, [clubId]);

        // 4. 🗺️ MAPA DE CALOR (usando created_at en lugar de date)
        const heatmap = await pool.query(`
            SELECT 
                EXTRACT(DOW FROM ts.created_at) as day_of_week,
                EXTRACT(HOUR FROM ts.created_at) as hour,
                COUNT(*) as count
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE u.club_id = $1
                AND ts.created_at >= $2
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour
        `, [clubId, sixMonthsAgo]);

        // 5. HORARIOS MÁS POPULARES
        const popularHours = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM ts.created_at) as hour,
                COUNT(*) as count
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE u.club_id = $1
                AND ts.created_at >= $2
            GROUP BY hour
            ORDER BY count DESC
            LIMIT 3
        `, [clubId, startOfMonth]);

        // 6. TOTAL DE ALUMNOS
        const totalStudents = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE club_id = $1 AND role = $2',
            [clubId, 'student']
        );

        // 7. ALUMNOS ACTIVOS (con sesiones en el último mes)
        const activeStudents = await pool.query(`
            SELECT COUNT(DISTINCT u.id) as count
            FROM users u
            JOIN training_sessions ts ON u.id = ts.user_id
            WHERE u.club_id = $1 
                AND u.role = 'student'
                AND ts.date >= $2
        `, [clubId, startOfMonth]);

        // 8. NUEVOS ALUMNOS ESTE MES
        const newStudents = await pool.query(
            `SELECT COUNT(*) as count 
             FROM users u
             WHERE u.club_id = $1 
             AND u.role = 'student'
             AND u.created_at >= $2`,
            [clubId, startOfMonth]
        );

        // 9. SESIONES ESTE MES
        const sessionsThisMonth = await pool.query(
            `SELECT COUNT(*) as count,
                    COALESCE(ROUND(AVG(rating), 1), 0) as avg_rating
             FROM training_sessions ts
             JOIN users u ON ts.user_id = u.id
             WHERE u.club_id = $1 
             AND ts.date >= $2`,
            [clubId, startOfMonth]
        );

        // 10. TOP ALUMNOS
        const topStudents = await pool.query(`
            SELECT 
                u.id, u.name, u.belt,
                COUNT(ts.id) as session_count,
                COALESCE(ROUND(AVG(ts.rating), 1), 0) as avg_rating,
                MAX(ts.date) as last_session
            FROM users u
            LEFT JOIN training_sessions ts ON u.id = ts.user_id
            WHERE u.club_id = $1 AND u.role = 'student'
            GROUP BY u.id, u.name, u.belt
            HAVING COUNT(ts.id) > 0
            ORDER BY session_count DESC
            LIMIT 5
        `, [clubId]);

        // 11. ALERTAS AUTOMÁTICAS
        const alerts = [];

        // Alerta: Alumnos inactivos (> 30 días)
        const inactiveThreshold = new Date();
        inactiveThreshold.setDate(inactiveThreshold.getDate() - 30);
        
        const inactiveStudents = await pool.query(`
            SELECT u.name, MAX(ts.date) as last_session
            FROM users u
            LEFT JOIN training_sessions ts ON u.id = ts.user_id
            WHERE u.club_id = $1 AND u.role = 'student'
            GROUP BY u.id, u.name
            HAVING MAX(ts.date) IS NULL OR MAX(ts.date) < $2
            LIMIT 3
        `, [clubId, inactiveThreshold]);

        inactiveStudents.rows.forEach(s => {
            alerts.push({
                type: 'inactivity',
                title: 'Alumno Inactivo',
                message: `${s.name} no entrena hace más de 30 días.`,
                icon: 'fa-clock',
                color: '#E67E22',
                created_at: new Date()
            });
        });

        // Alerta: Sesiones con baja calificación
        const lowRatingSessions = await pool.query(`
            SELECT u.name, ts.rating, ts.date
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE u.club_id = $1 AND ts.rating < 4 AND ts.date >= $2
            ORDER BY ts.rating ASC
            LIMIT 2
        `, [clubId, startOfMonth]);

        lowRatingSessions.rows.forEach(s => {
            alerts.push({
                type: 'warning',
                title: 'Sesión con baja calificación',
                message: `${s.name} calificó su última sesión con ${s.rating}/10`,
                icon: 'fa-exclamation-triangle',
                color: '#E74C3C',
                created_at: new Date(s.date)
            });
        });

        // Alerta: Logros recientes
        const highRatingSessions = await pool.query(`
            SELECT u.name, ts.rating, ts.date
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE u.club_id = $1 AND ts.rating >= 9 AND ts.date >= $2
            ORDER BY ts.rating DESC
            LIMIT 2
        `, [clubId, startOfMonth]);

        highRatingSessions.rows.forEach(s => {
            alerts.push({
                type: 'achievement',
                title: '¡Excelente sesión!',
                message: `${s.name} tuvo una sesión increíble: ${s.rating}/10`,
                icon: 'fa-trophy',
                color: '#F1C40F',
                created_at: new Date(s.date)
            });
        });

        // Respuesta final
        res.json({
            retention: {
                labels: retention.rows.map(r => r.label),
                data: retention.rows.map(r => parseInt(r.total_students || 0))
            },
            attendanceByDay: attendanceByDay.rows.map(r => ({
                day: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][r.day_of_week],
                sessions: parseInt(r.session_count),
                avgRating: parseFloat(r.avg_rating || 0)
            })),
            beltProgression: beltProgression.rows.map(r => ({
                belt: r.belt,
                count: parseInt(r.count),
                percentage: parseFloat(r.percentage || 0)
            })),
            heatmap: heatmap.rows,
            popularHours: popularHours.rows.map(r => ({
                hour: r.hour,
                count: parseInt(r.count)
            })),
            totalStudents: parseInt(totalStudents.rows[0]?.count || 0),
            activeStudents: parseInt(activeStudents.rows[0]?.count || 0),
            newStudentsThisMonth: parseInt(newStudents.rows[0]?.count || 0),
            sessionsThisMonth: parseInt(sessionsThisMonth.rows[0]?.count || 0),
            avgRatingThisMonth: parseFloat(sessionsThisMonth.rows[0]?.avg_rating || 0),
            avgSessionsPerStudent: (sessionsThisMonth.rows[0]?.count / (totalStudents.rows[0]?.count || 1)).toFixed(1),
            topStudents: topStudents.rows,
            alerts: alerts,
            generatedAt: new Date()
        });

    } catch (error) {
        console.error('❌ Error fetching club stats:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas: ' + error.message });
    }
});

// ==============================================
// REPORTE DE ASISTENCIA MENSUAL - VERSIÓN CORREGIDA
// ==============================================
app.get('/api/club/attendance-report', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        
        console.log('📊 Generando reporte de asistencia:', { month, year, club_id: req.user.club_id });
        
        const result = await pool.query(`
            SELECT 
                u.id, 
                u.name, 
                u.belt,
                COALESCE(COUNT(ts.id), 0) as session_count,
                CASE 
                    WHEN COUNT(ts.id) = 0 THEN 0
                    ELSE ROUND(COUNT(ts.id) * 100.0 / 4, 0)
                END as attendance_rate
            FROM users u
            LEFT JOIN training_sessions ts ON u.id = ts.user_id 
                AND EXTRACT(MONTH FROM ts.date) = $1::int
                AND EXTRACT(YEAR FROM ts.date) = $2::int
            WHERE u.club_id = $3 AND u.role = 'student'
            GROUP BY u.id, u.name, u.belt
            ORDER BY attendance_rate DESC, u.name
        `, [month, year, req.user.club_id]);
        
        console.log(`✅ ${result.rows.length} alumnos encontrados`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Error en reporte de asistencia:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// ==============================================
// REPORTE DE PAGOS
// ==============================================
app.get('/api/club/payments-report', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        
        const result = await pool.query(`
            SELECT 
                p.*,
                u.name as user_name,
                mp.name as plan_name,
                pr.id as receipt_id,
                pr.receipt_number
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            LEFT JOIN payment_receipts pr ON p.id = pr.payment_id
            WHERE p.club_id = $1 
                AND EXTRACT(MONTH FROM p.payment_date) = $2 
                AND EXTRACT(YEAR FROM p.payment_date) = $3
            ORDER BY p.payment_date DESC
        `, [req.user.club_id, month, year]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error en reporte de pagos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// Función auxiliar para verificar límites
// ==============================================
async function checkPlanLimit(userId, feature) {
    const result = await pool.query(`
        SELECT p.*, 
               (SELECT COUNT(*) FROM students WHERE club_id = u.club_id) as total_students
        FROM users u
        JOIN clubs c ON u.club_id = c.id
        JOIN plans p ON c.current_plan_id = p.id
        WHERE u.id = $1
    `, [userId]);
    
    const plan = result.rows[0];
    let canProceed = true;
    
    switch(feature) {
        case 'students':
            canProceed = plan.total_students < plan.max_students;
            break;
        case 'advanced_stats':
            canProceed = plan.can_use_advanced_stats;
            break;
        case 'export_reports':
            canProceed = plan.can_export_reports;
            break;
        case 'bulk_messages':
            canProceed = plan.can_send_bulk_messages;
            break;
        case 'api':
            canProceed = plan.has_api;
            break;
    }
    
    return {
        canProceed,
        plan: plan.code,
        limit: plan[`max_${feature}`] || null,
        current: feature === 'students' ? plan.total_students : null
    };
}

// Función auxiliar para nombres de cinturones (en el backend)
function getBeltName(beltKey) {
    const belts = {
        'white': 'Blanco',
        'blue': 'Azul',
        'purple': 'Púrpura',
        'brown': 'Marrón',
        'black': 'Negro'
    };
    return belts[beltKey] || 'Blanco';
}

// Ruta para buscar usuarios por nombre o email - FILTRADA POR CLUB
app.get('/api/users/search', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 3) {
            return res.status(400).json({ error: 'Término de búsqueda demasiado corto' });
        }
        
        console.log('🔍 Buscando usuarios en club:', req.user.club_id, 'con término:', q);
        
        const result = await pool.query(
            `SELECT id, name, email, belt, role 
             FROM users 
             WHERE (name ILIKE $1 OR email ILIKE $1) 
               AND id != $2 
               AND club_id = $3
             LIMIT 10`,
            [`%${q}%`, req.user.id, req.user.club_id]
        );
        
        console.log(`✅ Encontrados ${result.rows.length} usuarios en el club`);
        res.json(result.rows);
        
    } catch (err) {
        console.error('Error buscando usuarios:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Ruta para compartir con usuario específico - VERIFICAR MISMO CLUB
app.post('/api/gameplans/:id/share-with-user', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        console.log('🔗 Compartiendo Game Plan:', id, 'con usuario:', userId);
        
        // Verificar que el game plan existe y pertenece al usuario
        const gameplanCheck = await pool.query(
            'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2 AND club_id = $3',
            [id, req.user.id, req.user.club_id]
        );
        
        if (gameplanCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado' });
        }
        
        // Verificar que el usuario destino existe y pertenece al mismo club
        const userCheck = await pool.query(
            'SELECT * FROM users WHERE id = $1 AND club_id = $2',
            [userId, req.user.club_id]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado en tu academia' });
        }
        
        // Verificar si ya está compartido
        const shareCheck = await pool.query(
            'SELECT * FROM gameplan_shares WHERE gameplan_id = $1 AND to_user_id = $2',
            [id, userId]
        );
        
        if (shareCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Ya compartido con este usuario' });
        }
        
        // Compartir el game plan
        await pool.query(
            'INSERT INTO gameplan_shares (gameplan_id, from_user_id, to_user_id) VALUES ($1, $2, $3)',
            [id, req.user.id, userId]
        );
        
        // Crear notificación
        const gameplan = gameplanCheck.rows[0];
        const fromUser = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
        
        await pool.query(
            `INSERT INTO notifications (user_id, title, message, type, related_id, club_id) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, 'Game Plan Compartido', 
             `${fromUser.rows[0].name} te ha compartido el Game Plan: ${gameplan.name}`, 
             'share', id, req.user.club_id]
        );
        
        console.log('✅ Game Plan compartido exitosamente');
        res.json({ message: 'Game Plan compartido correctamente' });
        
    } catch (err) {
        console.error('Error compartiendo game plan:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// SISTEMA DE NOTIFICACIONES Y COMPROBANTES
// ==============================================

// 1. CONFIGURACIÓN DE NOTIFICACIONES
app.get('/api/notifications/settings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM notification_settings WHERE club_id = $1',
            [req.user.club_id]
        );
        
        if (result.rows.length === 0) {
            // Crear configuración por defecto
            const newSettings = await pool.query(
                `INSERT INTO notification_settings (club_id, reminder_days, reminder_time)
                 VALUES ($1, $2, $3) RETURNING *`,
                [req.user.club_id, [7, 3, 1], '09:00:00']
            );
            return res.json(newSettings.rows[0]);
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.put('/api/notifications/settings', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden modificar configuración' });
        }
        
        const { reminder_days, reminder_enabled, reminder_time, email_enabled, whatsapp_enabled } = req.body;
        
        const result = await pool.query(
            `UPDATE notification_settings 
             SET reminder_days = $1, reminder_enabled = $2, reminder_time = $3,
                 email_enabled = $4, whatsapp_enabled = $5, updated_at = CURRENT_TIMESTAMP
             WHERE club_id = $6 RETURNING *`,
            [reminder_days, reminder_enabled, reminder_time, email_enabled, whatsapp_enabled, req.user.club_id]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 2. NOTIFICACIONES DEL USUARIO (in-app)
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM scheduled_notifications 
             WHERE user_id = $1 
             ORDER BY scheduled_for DESC 
             LIMIT 50`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo notificaciones:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE scheduled_notifications SET status = $1 WHERE id = $2 AND user_id = $3',
            ['read', req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error marcando notificación como leída:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 3. GENERAR COMPROBANTE DE PAGO
app.post('/api/payments/:id/generate-receipt', authenticateToken, async (req, res) => {
    try {
        const paymentId = req.params.id;
        
        // Obtener datos del pago
        const paymentData = await pool.query(`
            SELECT p.*, u.name as user_name, u.email, u.belt,
                   mp.name as plan_name, mp.price,
                   c.name as club_name, c.address as club_address,
                   c.phone as club_phone, c.email as club_email
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON p.club_id = c.id
            WHERE p.id = $1
        `, [paymentId]);
        
        if (paymentData.rows.length === 0) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }
        
        const payment = paymentData.rows[0];
        
        // Verificar si ya existe comprobante
        const existingReceipt = await pool.query(
            'SELECT * FROM payment_receipts WHERE payment_id = $1',
            [paymentId]
        );
        
        let receipt;
        
        if (existingReceipt.rows.length > 0) {
            receipt = existingReceipt.rows[0];
        } else {
            // Crear nuevo comprobante
            receipt = await pool.query(
                `INSERT INTO payment_receipts (payment_id, user_id, club_id, pdf_data)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [paymentId, payment.user_id, payment.club_id, 'PENDING']
            );
            receipt = receipt.rows[0];
        }
        
        // Generar HTML del comprobante (luego convertiremos a PDF)
        const receiptHTML = generateReceiptHTML(payment, receipt);
        
        res.json({
            receipt,
            html: receiptHTML,
            payment
        });
        
    } catch (error) {
        console.error('Error generando comprobante:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 4. ENVIAR COMPROBANTE POR EMAIL
app.post('/api/receipts/:id/send-email', authenticateToken, async (req, res) => {
    try {
        const receiptId = req.params.id;
        
        await pool.query(
            `UPDATE payment_receipts 
             SET sent_email = true, email_sent_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [receiptId]
        );
        
        res.json({ success: true, message: 'Comprobante enviado por email' });
        
    } catch (error) {
        console.error('Error enviando email:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 5. ENVIAR COMPROBANTE POR WHATSAPP
app.post('/api/receipts/:id/send-whatsapp', authenticateToken, async (req, res) => {
    try {
        const receiptId = req.params.id;
        
        await pool.query(
            `UPDATE payment_receipts 
             SET sent_whatsapp = true, whatsapp_sent_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [receiptId]
        );
        
        res.json({ success: true, message: 'Comprobante enviado por WhatsApp' });
        
    } catch (error) {
        console.error('Error enviando WhatsApp:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 6. OBTENER COMPROBANTES DEL ALUMNO
app.get('/api/students/:id/receipts', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        const result = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   mp.name as plan_name
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            LEFT JOIN members m ON p.user_id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE r.user_id = $1
            ORDER BY p.payment_date DESC
        `, [studentId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo comprobantes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// REPORTE DE DEUDORES - VERSIÓN DEFINITIVA (SIN EXTRACT)
// ==============================================
app.get('/api/club/debtors', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden ver deudores' });
        }
        
        const { days, plan_id, payment_method } = req.query;
        
        console.log('📊 Generando reporte de deudores con filtros:', { days, plan_id, payment_method });
        
        // Consulta base - SIN EXTRACT, usamos cálculo directo
        let query = `
            SELECT 
                u.id, u.name, u.email, u.phone, u.belt,
                m.membership_plan_id,
                mp.name as plan_name,
                mp.price,
                m.end_date,
                (CURRENT_DATE - m.end_date) as days_overdue,
                (SELECT MAX(payment_date) FROM payments WHERE user_id = u.id) as last_payment_date,
                (SELECT payment_method FROM payments WHERE user_id = u.id ORDER BY payment_date DESC LIMIT 1) as last_payment_method
            FROM users u
            JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE u.club_id = $1 
                AND u.role = 'student'
                AND m.status = 'active'
                AND m.end_date < CURRENT_DATE
        `;
        
        const params = [req.user.club_id];
        let paramCount = 1;
        
        // Filtro por antigüedad (días de mora)
        if (days && !isNaN(parseInt(days))) {
            paramCount++;
            query += ` AND (CURRENT_DATE - m.end_date) > $${paramCount}`;
            params.push(parseInt(days));
        }
        
        // Filtro por plan
        if (plan_id && plan_id !== 'all' && !isNaN(parseInt(plan_id))) {
            paramCount++;
            query += ` AND m.membership_plan_id = $${paramCount}`;
            params.push(parseInt(plan_id));
        }
        
        // Filtro por método de pago
        if (payment_method && payment_method !== 'all') {
            paramCount++;
            query += ` AND (SELECT payment_method FROM payments WHERE user_id = u.id ORDER BY payment_date DESC LIMIT 1) = $${paramCount}`;
            params.push(payment_method);
        }
        
        query += ` ORDER BY days_overdue DESC, u.name`;
        
        console.log('🔍 Ejecutando query:', query);
        console.log('📦 Parámetros:', params);
        
        const result = await pool.query(query, params);
        
        // Calcular total de deuda
        const totalDebt = result.rows.reduce((sum, row) => {
            return sum + (parseFloat(row.price) || 0);
        }, 0);
        
        console.log(`✅ ${result.rows.length} deudores encontrados, deuda total: $${totalDebt}`);
        
        res.json({
            debtors: result.rows,
            total_debt: totalDebt,
            total_count: result.rows.length
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo deudores:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// ==============================================
// EXPORTAR DEUDORES A EXCEL (CSV) - VERSIÓN CORREGIDA
// ==============================================
app.get('/api/club/debtors/export', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden exportar' });
        }
        
        const { days, plan_id, payment_method } = req.query;
        
        let query = `
            SELECT 
                u.name, u.email, u.phone, u.belt,
                mp.name as plan_name,
                mp.price,
                m.end_date,
                (CURRENT_DATE - m.end_date) as days_overdue,
                to_char(m.end_date, 'DD/MM/YYYY') as overdue_date,
                (SELECT to_char(payment_date, 'DD/MM/YYYY') FROM payments WHERE user_id = u.id ORDER BY payment_date DESC LIMIT 1) as last_payment,
                (SELECT payment_method FROM payments WHERE user_id = u.id ORDER BY payment_date DESC LIMIT 1) as last_payment_method
            FROM users u
            JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE u.club_id = $1 
                AND u.role = 'student'
                AND m.status = 'active'
                AND m.end_date < CURRENT_DATE
        `;
        
        const params = [req.user.club_id];
        let paramCount = 1;
        
        if (days && !isNaN(parseInt(days))) {
            paramCount++;
            query += ` AND (CURRENT_DATE - m.end_date) > $${paramCount}`;
            params.push(parseInt(days));
        }
        
        if (plan_id && plan_id !== 'all' && !isNaN(parseInt(plan_id))) {
            paramCount++;
            query += ` AND m.membership_plan_id = $${paramCount}`;
            params.push(parseInt(plan_id));
        }
        
        if (payment_method && payment_method !== 'all') {
            paramCount++;
            query += ` AND (SELECT payment_method FROM payments WHERE user_id = u.id ORDER BY payment_date DESC LIMIT 1) = $${paramCount}`;
            params.push(payment_method);
        }
        
        query += ` ORDER BY days_overdue DESC, u.name`;
        
        const result = await pool.query(query, params);
        
        // Generar CSV
        const csvRows = [];
        
        // Headers
        csvRows.push([
            'Nombre',
            'Email',
            'Teléfono',
            'Cinturón',
            'Plan',
            'Monto',
            'Vencimiento',
            'Días de mora',
            'Último pago',
            'Método último pago'
        ].join(','));
        
        // Función auxiliar para nombres de cinturón
        const getBeltName = (belt) => {
            const belts = {
                'white': 'Blanco',
                'blue': 'Azul',
                'purple': 'Púrpura',
                'brown': 'Marrón',
                'black': 'Negro'
            };
            return belts[belt] || belt;
        };
        
        // Datos
        result.rows.forEach(row => {
            csvRows.push([
                `"${row.name || ''}"`,
                `"${row.email || ''}"`,
                `"${row.phone || ''}"`,
                getBeltName(row.belt),
                `"${row.plan_name || ''}"`,
                row.price || 0,
                row.overdue_date || '',
                row.days_overdue || 0,
                row.last_payment || '',
                row.last_payment_method || ''
            ].join(','));
        });
        
        const csv = csvRows.join('\n');
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=deudores.csv');
        res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
        
        res.send(csv);
        
    } catch (error) {
        console.error('Error exportando deudores:', error);
        res.status(500).json({ error: 'Error al exportar: ' + error.message });
    }
});

// ==============================================
// VISTA PREVIA DEL COMPROBANTE (HTML)
// ==============================================
app.get('/api/receipts/:id/preview', authenticateToken, async (req, res) => {
    try {
        const receiptId = req.params.id;
        
        // Obtener datos del comprobante
        const receiptData = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   p.payment_method,
                   u.name as user_name, u.email, u.belt,
                   mp.name as plan_name,
                   c.name as club_name, c.phone as club_phone
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON r.club_id = c.id
            WHERE r.id = $1
        `, [receiptId]);
        
        if (receiptData.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }
        
        const data = receiptData.rows[0];
        
        // Generar HTML
        const html = generateReceiptHTML(data);
        
        // Enviar HTML para vista previa
        res.send(html);
        
    } catch (error) {
        console.error('Error generando vista previa:', error);
        res.status(500).json({ error: 'Error al generar vista previa' });
    }
});

// ==============================================
// DESCARGAR COMPROBANTE (con autenticación en URL)
// ==============================================
app.get('/api/receipts/:id/download', authenticateToken, async (req, res) => {
    try {
        const receiptId = req.params.id;
        
        // Obtener datos del comprobante
        const receiptData = await pool.query(`
            SELECT r.*, p.amount, p.payment_date, p.period_start, p.period_end,
                   p.payment_method,
                   u.name as user_name, u.email, u.belt,
                   mp.name as plan_name,
                   c.name as club_name, c.phone as club_phone
            FROM payment_receipts r
            JOIN payments p ON r.payment_id = p.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON r.club_id = c.id
            WHERE r.id = $1
        `, [receiptId]);
        
        if (receiptData.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }
        
        const data = receiptData.rows[0];
        
        // Generar HTML
        const html = generateReceiptHTML(data);
        
        // Configurar headers para descarga
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename=comprobante-${data.receipt_number || receiptId}.html`);
        
        res.send(html);
        
    } catch (error) {
        console.error('Error generando comprobante:', error);
        res.status(500).json({ error: 'Error al generar comprobante' });
    }
});

// ==============================================
// CREAR PREFERENCIA DE PAGO (VERSIÓN SIMPLIFICADA Y CORREGIDA)
// ==============================================

app.post('/api/payments/create-preference', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden gestionar pagos' });
        }

        const { plan_id, is_yearly, club_id } = req.body;
        
        console.log('💰 Creando preferencia de pago para plan:', { plan_id, is_yearly, club_id });
        
        // Obtener información del plan
        const planResult = await pool.query(
            'SELECT * FROM plans WHERE id = $1',
            [plan_id]
        );
        
        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan no encontrado' });
        }
        
        const plan = planResult.rows[0];
        const price = is_yearly ? plan.price_yearly : plan.price_monthly;
        const title = is_yearly ? `Plan ${plan.name} Anual` : `Plan ${plan.name} Mensual`;
        const description = `Suscripción ${is_yearly ? 'anual' : 'mensual'} al plan ${plan.name} para tu academia de BJJ`;
        
        // Obtener información de la academia
        const clubResult = await pool.query(
            'SELECT name, email FROM clubs WHERE id = $1',
            [club_id || req.user.club_id]
        );
        
        const club = clubResult.rows[0];
        
        // URL base para los back_urls
        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        
        // Crear preferencia de pago - VERSIÓN SIMPLIFICADA
        const body = {
            items: [
                {
                    title: title,
                    description: description,
                    quantity: 1,
                    currency_id: 'ARS',
                    unit_price: parseFloat(price)
                }
            ],
            payer: {
                name: req.user.name,
                email: req.user.email
            },
            back_urls: {
                success: `${baseUrl}/payment-success`,
                failure: `${baseUrl}/payment-failure`,
                pending: `${baseUrl}/payment-pending`
            },
            external_reference: JSON.stringify({
                user_id: req.user.id,
                club_id: club_id || req.user.club_id,
                plan_id: plan_id,
                is_yearly: is_yearly,
                amount: price,
                plan_code: plan.code,
                plan_name: plan.name,
                club_name: club.name
            }),
            notification_url: `${process.env.APP_URL || 'http://localhost:5000'}/api/payments/webhook`,
            metadata: {
                club_name: club.name,
                user_name: req.user.name,
                plan_name: plan.name
            }
        };
        
        console.log('📦 Body de preferencia:', JSON.stringify(body, null, 2));
        
        // Crear la preferencia usando la nueva sintaxis
        const response = await preference.create({ body });
        
        console.log('✅ Preferencia de pago creada:', response.id);
        console.log('   URL de pago:', response.init_point);
        
        // Guardar la preferencia en la base de datos
        await pool.query(`
            INSERT INTO payment_preferences 
            (preference_id, user_id, club_id, plan_id, amount, status, metadata, payment_data)
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
        `, [
            response.id,
            req.user.id,
            club_id || req.user.club_id,
            plan_id,
            price,
            JSON.stringify({
                plan_code: plan.code,
                plan_name: plan.name,
                is_yearly: is_yearly,
                club_name: club.name
            }),
            JSON.stringify(body)
        ]);
        
        res.json({
            success: true,
            preference_id: response.id,
            init_point: response.init_point,
            sandbox_init_point: response.sandbox_init_point
        });
        
    } catch (error) {
        console.error('Error creando preferencia de pago:', error);
        
        // Mostrar más detalles del error
        if (error.cause) {
            console.error('Causa del error:', error.cause);
        }
        
        res.status(500).json({ 
            error: 'Error al crear la preferencia de pago',
            details: error.message,
            cause: error.cause
        });
    }
});

// ==============================================
// WEBHOOK DE MERCADO PAGO
// ==============================================

app.post('/api/payments/webhook', async (req, res) => {
    try {
        const { type, data, action } = req.body;
        
        console.log('📥 Webhook recibido:', { type, data, action });
        
        // Para pagos con Checkout API de Pagos
        if (type === 'payment' || (data && data.id)) {
            const paymentId = data?.id || data;
            
            console.log('💰 Procesando pago ID:', paymentId);
            
            // Obtener información del pago usando la nueva sintaxis
            const paymentResponse = await payment.get({ id: paymentId });
            const paymentData = paymentResponse;
            
            console.log('💰 Información del pago:', {
                id: paymentData.id,
                status: paymentData.status,
                status_detail: paymentData.status_detail,
                amount: paymentData.transaction_amount,
                external_reference: paymentData.external_reference
            });
            
            if (paymentData.status === 'approved') {
                const externalReference = JSON.parse(paymentData.external_reference);
                
                console.log('✅ Pago aprobado:', {
                    payment_id: paymentId,
                    user_id: externalReference.user_id,
                    club_id: externalReference.club_id,
                    plan_id: externalReference.plan_id,
                    amount: paymentData.transaction_amount
                });
                
                // Actualizar la preferencia en la base de datos
                await pool.query(`
                    UPDATE payment_preferences 
                    SET status = 'approved', 
                        payment_id = $1,
                        payment_data = $2,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE preference_id = $3
                `, [paymentId, JSON.stringify(paymentData), paymentData.preference_id]);
                
                // Crear registro de pago
                await pool.query(`
                    INSERT INTO payments (
                        club_id, user_id, plan_id, amount, payment_method, 
                        payment_id, status, payment_date, period_start, period_end
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [
                    externalReference.club_id,
                    externalReference.user_id,
                    externalReference.plan_id,
                    paymentData.transaction_amount,
                    'mercadopago',
                    paymentId,
                    'completed',
                    new Date(paymentData.date_approved),
                    new Date(),
                    new Date(Date.now() + (externalReference.is_yearly ? 365 : 30) * 24 * 60 * 60 * 1000)
                ]);
                
                // Actualizar la suscripción del club
                await pool.query(`
                    UPDATE clubs 
                    SET current_plan_id = $1,
                        subscription_status = 'active',
                        subscription_start_date = CURRENT_TIMESTAMP,
                        subscription_end_date = CURRENT_TIMESTAMP + 
                            CASE WHEN $2 THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                `, [externalReference.plan_id, externalReference.is_yearly, externalReference.club_id]);
                
                // Actualizar o insertar suscripción
                await pool.query(`
                    INSERT INTO club_subscriptions 
                    (club_id, plan_id, status, start_date, end_date, auto_renew, payment_method)
                    VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, 
                            CURRENT_TIMESTAMP + CASE WHEN $3 THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END,
                            true, 'mercadopago')
                    ON CONFLICT (club_id) 
                    DO UPDATE SET 
                        plan_id = EXCLUDED.plan_id,
                        status = 'active',
                        start_date = EXCLUDED.start_date,
                        end_date = EXCLUDED.end_date,
                        auto_renew = true,
                        payment_method = 'mercadopago',
                        updated_at = CURRENT_TIMESTAMP
                `, [externalReference.club_id, externalReference.plan_id, externalReference.is_yearly]);
                
                // Crear notificación para el usuario
                await pool.query(`
                    INSERT INTO notifications (user_id, club_id, title, message, type, related_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    externalReference.user_id,
                    externalReference.club_id,
                    '✅ Pago Aprobado',
                    `¡Gracias por tu pago! Tu plan ${externalReference.plan_name} ha sido activado correctamente.`,
                    'payment_success',
                    paymentId
                ]);
            }
        }
        
        res.status(200).json({ received: true });
        
    } catch (error) {
        console.error('Error en webhook:', error);
        res.status(500).json({ error: 'Error procesando webhook' });
    }
});

// ==============================================
// VERIFICAR ESTADO DE PAGO
// ==============================================

app.get('/api/payments/status/:preferenceId', authenticateToken, async (req, res) => {
    try {
        const { preferenceId } = req.params;
        
        const result = await pool.query(`
            SELECT * FROM payment_preferences 
            WHERE preference_id = $1 AND user_id = $2
        `, [preferenceId, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Preferencia no encontrada' });
        }
        
        let status = result.rows[0].status;
        let paymentId = result.rows[0].payment_id;
        
        // Si el estado es pending y tenemos payment_id, consultar a Mercado Pago
        if (status === 'pending' && paymentId) {
            try {
                const paymentResponse = await payment.get({ id: paymentId });
                if (paymentResponse.status === 'approved') {
                    status = 'approved';
                    // Actualizar en BD
                    await pool.query(`
                        UPDATE payment_preferences 
                        SET status = 'approved', updated_at = CURRENT_TIMESTAMP
                        WHERE preference_id = $1
                    `, [preferenceId]);
                }
            } catch (error) {
                console.error('Error consultando pago a MP:', error);
            }
        }
        
        res.json({
            status: status,
            payment_id: paymentId,
            preference_id: preferenceId
        });
        
    } catch (error) {
        console.error('Error verificando pago:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// SIMULAR PAGO (PARA DESARROLLO)
// ==============================================

app.post('/api/payments/simulate', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden gestionar pagos' });
        }

        const { plan_id, is_yearly, club_id } = req.body;
        
        console.log('💰 SIMULANDO PAGO para plan:', { plan_id, is_yearly, club_id });
        
        // Obtener información del plan
        const planResult = await pool.query(
            'SELECT * FROM plans WHERE id = $1',
            [plan_id]
        );
        
        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan no encontrado' });
        }
        
        const plan = planResult.rows[0];
        const price = is_yearly ? plan.price_yearly : plan.price_monthly;
        
        // Simular un ID de pago
        const simulatedPaymentId = `SIM_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        // Crear registro de pago simulado
        await pool.query(`
            INSERT INTO payments (
                club_id, user_id, plan_id, amount, payment_method, 
                payment_id, status, payment_date, period_start, period_end
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            club_id || req.user.club_id,
            req.user.id,
            plan_id,
            price,
            'simulado',
            simulatedPaymentId,
            'completed',
            new Date(),
            new Date(),
            new Date(Date.now() + (is_yearly ? 365 : 30) * 24 * 60 * 60 * 1000)
        ]);
        
        // Actualizar la suscripción del club
        await pool.query(`
            UPDATE clubs 
            SET current_plan_id = $1,
                subscription_status = 'active',
                subscription_start_date = CURRENT_TIMESTAMP,
                subscription_end_date = CURRENT_TIMESTAMP + 
                    CASE WHEN $2 THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [plan_id, is_yearly, club_id || req.user.club_id]);
        
        // Actualizar o insertar suscripción
        await pool.query(`
            INSERT INTO club_subscriptions 
            (club_id, plan_id, status, start_date, end_date, auto_renew, payment_method)
            VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, 
                    CURRENT_TIMESTAMP + CASE WHEN $3 THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END,
                    true, 'simulado')
            ON CONFLICT (club_id) 
            DO UPDATE SET 
                plan_id = EXCLUDED.plan_id,
                status = 'active',
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                auto_renew = true,
                payment_method = 'simulado',
                updated_at = CURRENT_TIMESTAMP
        `, [club_id || req.user.club_id, plan_id, is_yearly]);
        
        // Crear notificación
        await pool.query(`
            INSERT INTO notifications (user_id, club_id, title, message, type, related_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            req.user.id,
            club_id || req.user.club_id,
            '✅ Pago Simulado Exitoso',
            `¡Pago simulado completado! Tu plan ${plan.name} ha sido activado correctamente. (Modo desarrollo)`,
            'payment_success',
            simulatedPaymentId
        ]);
        
        console.log('✅ Pago simulado completado');
        
        res.json({
            success: true,
            message: 'Pago simulado completado exitosamente',
            payment_id: simulatedPaymentId,
            plan_name: plan.name,
            is_yearly: is_yearly
        });
        
    } catch (error) {
        console.error('Error en pago simulado:', error);
        res.status(500).json({ error: 'Error al simular pago' });
    }
});

// Obtener historial de pagos del club
app.get('/api/club/payments-history', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden ver el historial de pagos' });
        }
        
        const result = await pool.query(`
            SELECT p.*, pl.name as plan_name, pl.code as plan_code
            FROM payments p
            JOIN plans pl ON p.plan_id = pl.id
            WHERE p.club_id = $1
            ORDER BY p.payment_date DESC
            LIMIT 50
        `, [req.user.club_id]);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error obteniendo historial de pagos:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});
// ==============================================
// GENERAR HTML DEL COMPROBANTE - VERSIÓN SIN ADDRESS
// ==============================================
function generateReceiptHTML(data) {
    const date = new Date(data.payment_date).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const periodStart = new Date(data.period_start).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const periodEnd = new Date(data.period_end).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const amount = parseInt(data.amount).toLocaleString('es-AR');
    
    // Generar número de recibo si no existe
    const receiptNumber = data.receipt_number || 
        `REC-${data.payment_id}-${new Date(data.payment_date).getFullYear()}`;
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Comprobante de Pago - ${receiptNumber}</title>
            <style>
                body {
                    font-family: 'Arial', sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: #f5f5f5;
                }
                .receipt {
                    max-width: 800px;
                    margin: 0 auto;
                    background: white;
                    border: 2px solid #8B4513;
                    border-radius: 15px;
                    overflow: hidden;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                }
                .header {
                    background: linear-gradient(135deg, #2C3E50, #34495E);
                    color: white;
                    padding: 30px;
                    text-align: center;
                    border-bottom: 3px solid #D4AF37;
                }
                .header h1 {
                    margin: 0;
                    font-size: 2.5rem;
                    color: #D4AF37;
                }
                .header p {
                    margin: 5px 0 0;
                    opacity: 0.9;
                }
                .receipt-number {
                    background: #D4AF37;
                    color: #2C3E50;
                    padding: 10px;
                    text-align: center;
                    font-weight: bold;
                    font-size: 1.2rem;
                    border-bottom: 2px solid #8B4513;
                }
                .content {
                    padding: 30px;
                }
                .info-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    margin-bottom: 30px;
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                }
                .info-item {
                    border-bottom: 1px solid #ddd;
                    padding: 8px 0;
                }
                .info-label {
                    color: #7F8C8D;
                    font-size: 0.9rem;
                    margin-bottom: 3px;
                }
                .info-value {
                    color: #2C3E50;
                    font-weight: bold;
                    font-size: 1.1rem;
                }
                .payment-details {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border-left: 5px solid #27AE60;
                }
                .amount {
                    font-size: 2.5rem;
                    font-weight: bold;
                    color: #27AE60;
                    text-align: center;
                    margin: 20px 0;
                }
                .footer {
                    background: #f8f9fa;
                    padding: 20px;
                    text-align: center;
                    border-top: 2px solid #D4AF37;
                    color: #7F8C8D;
                    font-size: 0.9rem;
                }
                .footer p {
                    margin: 5px 0;
                }
                @media print {
                    body { background: white; }
                    .receipt { box-shadow: none; border: 2px solid #000; }
                }
            </style>
        </head>
        <body>
            <div class="receipt">
                <div class="header">
                    <h1>${data.club_name || 'ACADEMIA DE JIU-JITSU'}</h1>
                    ${data.club_phone ? `<p>Tel: ${data.club_phone}</p>` : ''}
                </div>
                
                <div class="receipt-number">
                    COMPROBANTE DE PAGO N° ${receiptNumber}
                </div>
                
                <div class="content">
                    <div class="info-grid">
                        <div>
                            <div class="info-item">
                                <div class="info-label">Alumno</div>
                                <div class="info-value">${data.user_name}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Email</div>
                                <div class="info-value">${data.email}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Cinturón</div>
                                <div class="info-value">${getBeltName(data.belt)}</div>
                            </div>
                        </div>
                        <div>
                            <div class="info-item">
                                <div class="info-label">Fecha de pago</div>
                                <div class="info-value">${date}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Método de pago</div>
                                <div class="info-value">
                                    ${data.payment_method === 'cash' ? 'Efectivo' :
                                      data.payment_method === 'transfer' ? 'Transferencia' :
                                      data.payment_method === 'credit' ? 'Tarjeta de Crédito' :
                                      data.payment_method === 'debit' ? 'Tarjeta de Débito' : data.payment_method}
                                </div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">Plan</div>
                                <div class="info-value">${data.plan_name || 'Membresía'}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="payment-details">
                        <h3 style="margin-top: 0; color: #2C3E50;">Detalle del pago</h3>
                        <p><strong>Período:</strong> ${periodStart} al ${periodEnd}</p>
                        <p><strong>Concepto:</strong> Membresía mensual</p>
                    </div>
                    
                    <div class="amount">
                        $${amount}
                    </div>
                    
                    <p style="text-align: center; color: #27AE60; font-weight: bold;">
                        ✓ PAGO REGISTRADO
                    </p>
                </div>
                
                <div class="footer">
                    <p>¡Gracias por confiar en nosotros!</p>
                    <p>Este comprobante fue generado electrónicamente el ${new Date().toLocaleString()}</p>
                    <p style="font-size: 0.8rem;">${receiptNumber}</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

// Obtener solicitudes pendientes para el club
app.get('/api/club/pending-requests', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden ver solicitudes' });
        }
        
        const result = await pool.query(`
            SELECT mr.*, u.name as user_name, u.email, u.belt, u.created_at as user_registered_at
            FROM membership_requests mr
            JOIN users u ON mr.user_id = u.id
            WHERE mr.club_id = $1 AND mr.status = 'pending'
            ORDER BY mr.request_date DESC
        `, [req.user.club_id]);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error obteniendo solicitudes:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Aprobar solicitud
app.post('/api/club/approve-request/:requestId', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden aprobar solicitudes' });
        }
        
        const { requestId } = req.params;
        
        const requestResult = await client.query(
            `SELECT mr.*, u.name as user_name, u.email, c.name as club_name
             FROM membership_requests mr
             JOIN users u ON mr.user_id = u.id
             JOIN clubs c ON mr.club_id = c.id
             WHERE mr.id = $1 AND mr.club_id = $2 AND mr.status = 'pending'`,
            [requestId, req.user.club_id]
        );
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        
        const request = requestResult.rows[0];
        
        await client.query('BEGIN');
        
        // Actualizar usuario como aprobado
        await client.query(
            `UPDATE users SET is_approved = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [request.user_id]
        );
        
        // Actualizar solicitud
        await client.query(
            `UPDATE membership_requests 
             SET status = 'approved', response_date = CURRENT_TIMESTAMP, responded_by = $1
             WHERE id = $2`,
            [req.user.id, requestId]
        );
        
        // Crear notificación para el alumno
        await client.query(
            `INSERT INTO notifications (user_id, title, message, type, related_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [request.user_id, '✅ ¡Bienvenido a la academia!', 
             `El Mestre ${req.user.name} ha aprobado tu solicitud para unirte a ${request.club_name}. ¡Ya puedes explorar todo el contenido de tu academia!`,
             'approval', request.club_id]
        );
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Usuario ${request.user_name} aprobado correctamente`,
            user: { id: request.user_id, name: request.user_name, email: request.user_email }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error aprobando solicitud:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Rechazar solicitud
app.post('/api/club/reject-request/:requestId', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden rechazar solicitudes' });
        }
        
        const { requestId } = req.params;
        const { rejection_reason } = req.body;
        
        const requestResult = await client.query(
            `SELECT mr.*, u.name as user_name, u.email, c.name as club_name
             FROM membership_requests mr
             JOIN users u ON mr.user_id = u.id
             JOIN clubs c ON mr.club_id = c.id
             WHERE mr.id = $1 AND mr.club_id = $2 AND mr.status = 'pending'`,
            [requestId, req.user.club_id]
        );
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        
        const request = requestResult.rows[0];
        
        await client.query('BEGIN');
        
        // Actualizar solicitud como rechazada
        await client.query(
            `UPDATE membership_requests 
             SET status = 'rejected', 
                 response_date = CURRENT_TIMESTAMP, 
                 responded_by = $1,
                 rejection_reason = $2
             WHERE id = $3`,
            [req.user.id, rejection_reason || 'No especificada', requestId]
        );
        
        // Eliminar al usuario (no puede volver a intentar con el mismo email)
        await client.query(`DELETE FROM users WHERE id = $1`, [request.user_id]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Solicitud de ${request.user_name} rechazada y usuario eliminado`,
            user: { id: request.user_id, name: request.user_name, email: request.user_email }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rechazando solicitud:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// ==============================================
// MIDDLEWARE PARA VERIFICAR APROBACIÓN - VERSIÓN CORREGIDA
// ==============================================
function checkApproved(req, res, next) {
    // Los mestres siempre pasan
    if (req.user.role === 'master') {
        return next();
    }
    
    // Para alumnos, verificar si está aprobado
    // Si el token tiene is_approved = true, pasa
    if (req.user.is_approved === true) {
        return next();
    }
    
    // Si no está aprobado, verificar en la base de datos por si acaso
    // (esto soluciona problemas de token desactualizado)
    pool.query(
        'SELECT is_approved FROM users WHERE id = $1',
        [req.user.id]
    ).then(result => {
        if (result.rows.length > 0 && result.rows[0].is_approved === true) {
            // Actualizar el req.user con el valor correcto
            req.user.is_approved = true;
            return next();
        }
        
        return res.status(403).json({ 
            error: 'Cuenta pendiente de aprobación',
            code: 'ACCOUNT_NOT_APPROVED',
            message: 'Tu cuenta está pendiente de aprobación por el mestre de tu academia'
        });
    }).catch(error => {
        console.error('Error verificando aprobación:', error);
        return res.status(500).json({ error: 'Error del servidor' });
    });
}

// Aplicar middleware a rutas protegidas
app.use('/api/students', authenticateToken, checkApproved);
app.use('/api/training-sessions', authenticateToken, checkApproved);
app.use('/api/techniques', authenticateToken, checkApproved);
app.use('/api/gameplans', authenticateToken, checkApproved);
app.use('/api/class-plans', authenticateToken, checkApproved);
app.use('/api/events', authenticateToken, checkApproved);
app.use('/api/membership', authenticateToken, checkApproved);

// Agrega este endpoint temporal para limpiar datos corruptos
app.post('/api/admin/cleanup', async (req, res) => {
    try {
        // 1. Eliminar registros huérfanos
        await pool.query(`
            DELETE FROM gameplans 
            WHERE user_id NOT IN (SELECT id FROM users)
        `);
        
        await pool.query(`
            DELETE FROM training_sessions 
            WHERE user_id NOT IN (SELECT id FROM users)
        `);
        
        // 2. Verificar usuarios existentes
        const users = await pool.query('SELECT id, email FROM users');
        
        res.json({
            message: 'Limpieza completada',
            users: users.rows,
            deleted_orphaned_records: true
        });
    } catch (err) {
        console.error('Error en limpieza:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});


// Aprobar técnica
app.put('/api/techniques/:id/approve', authenticateToken, async (req, res) => {
  try {
    console.log('Usuario intentando aprobar:', req.user);
    
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden aprobar técnicas' });
    }

    const { id } = req.params;
    
    // ✅ OBTENER NOMBRE DEL MESTRE ACTUAL (CORRECTO)
    const mestreResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [req.user.id]
    );
    
    // ✅ DEFINIR mestreName CORRECTAMENTE
    const mestreName = mestreResult.rows[0]?.name || 'El Mestre';
    console.log('Nombre del mestre:', mestreName);

    // Primero obtener la técnica para saber quién la creó
    const techniqueResult = await pool.query(
      'SELECT * FROM techniques WHERE id = $1',
      [id]
    );
    
    if (techniqueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Técnica no encontrada' });
    }

    const technique = techniqueResult.rows[0];
    
    // Actualizar la técnica como aprobada
    const updateResult = await pool.query(
      'UPDATE techniques SET approved = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    const updatedTechnique = updateResult.rows[0];
    
    // ✅ CREAR NOTIFICACIÓN CON NOMBRE CORRECTO
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, related_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        technique.created_by, 
        'Técnica Aprobada', 
        `Tu técnica "${technique.name}" fue aprobada por el Mestre ${mestreName}`, 
        'approval', 
        technique.id
      ]
    );
    
    console.log('Técnica aprobada exitosamente:', updatedTechnique.id);
    res.json(updatedTechnique);
    
  } catch (err) {
    console.error('Error aprobando técnica:', err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
  }
});

// Rechazar técnica
app.put('/api/techniques/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden rechazar técnicas' });
    }

    const { id } = req.params;
    const { reason } = req.body;
    
    // ✅ OBTENER NOMBRE DEL MESTRE ACTUAL
    const mestreResult = await pool.query(
      'SELECT name FROM users WHERE id = $1',
      [req.user.id]
    );
    
    // ✅ DEFINIR mestreName CORRECTAMENTE
    const mestreName = mestreResult.rows[0]?.name || 'El Mestre';

    // Obtener información de la técnica
    const techniqueResult = await pool.query(
      'SELECT * FROM techniques WHERE id = $1',
      [id]
    );
    
    if (techniqueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Técnica no encontrada' });
    }
    
    const technique = techniqueResult.rows[0];
    
    // Eliminar la técnica
    await pool.query('DELETE FROM techniques WHERE id = $1', [id]);
    
    // ✅ CREAR NOTIFICACIÓN CON NOMBRE CORRECTO
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, related_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        technique.created_by, 
        'Técnica Rechazada', 
        `Tu técnica "${technique.name}" fue rechazada por el Mestre ${mestreName}. Razón: ${reason || 'No especificada'}`, 
        'rejection', 
        id
      ]
    );
    
    res.json({ message: 'Técnica rechazada y notificación enviada' });
  } catch (err) {
    console.error('Error rechazando técnica:', err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
  }
});

// Obtener game plan específico
app.get('/api/gameplans/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('🔍 Buscando Game Plan ID:', id);
        
        const result = await pool.query(`
            SELECT 
                g.*, 
                u.name AS creator_name,
                COALESCE(
                  json_agg(
                    DISTINCT jsonb_build_object(
                      'id', n.id,
                      'technique_id', n.technique_id,
                      'name', n.name,
                      'type', n.type,
                      'x', n.x,
                      'y', n.y
                    )
                  ) FILTER (WHERE n.id IS NOT NULL), '[]'
                ) AS nodes,
                COALESCE(
                  json_agg(
                    DISTINCT jsonb_build_object(
                      'id', c.id,
                      'from_node', c.from_node,
                      'to_node', c.to_node
                    )
                  ) FILTER (WHERE c.id IS NOT NULL), '[]'
                ) AS connections
            FROM gameplans g
            LEFT JOIN gameplan_nodes n ON g.id = n.gameplan_id
            LEFT JOIN gameplan_connections c ON g.id = c.gameplan_id
            LEFT JOIN users u ON g.user_id = u.id
            WHERE g.id = $1 AND (g.user_id = $2 OR g.club_id = $3 OR g.is_public = true)
            GROUP BY g.id, u.name`,
            [id, req.user.id, req.user.club_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado' });
        }
        
        const gameplan = result.rows[0];
        console.log(`✅ Game Plan ${id} cargado:`, {
            id: gameplan.id,
            name: gameplan.name,
            description: gameplan.description,
            nodesCount: gameplan.nodes.length,
            connectionsCount: gameplan.connections.length
        });
        
        res.json(gameplan);
        
    } catch (err) {
        console.error('❌ Error obteniendo game plan:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Mejor solución - función para encontrar puerto libre
const findAvailablePort = (startPort) => {
    return new Promise((resolve, reject) => {
        const server = require('http').createServer();
        
        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(findAvailablePort(startPort + 1));
            } else {
                reject(err);
            }
        });
    });
};

// En server.js, agregar:
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        
        const result = await pool.query(
            'SELECT id, name, email, belt, role, club_id, is_approved FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});
// ==================== RUTAS PARA EVENTOS Y HORARIOS ====================
// Obtener eventos del club
app.get('/api/events', authenticateToken, async (req, res) => {
    try {
        console.log(`📅 [EVENTS] Obteniendo eventos para club: ${req.user.club_id}`);
        
        const result = await pool.query(
            `SELECT e.*, 
                    COALESCE(e.torneo_data, '{}'::jsonb) as torneo_data,
                    u.name as created_by_name
             FROM events e
             LEFT JOIN users u ON e.created_by = u.id
             WHERE e.club_id = $1
             ORDER BY e.date ASC`,
            [req.user.club_id]
        );
        
        const events = result.rows.map(event => ({
            ...event,
            torneo_data: event.torneo_data || {}
        }));
        
        res.json(events);
        
    } catch (err) {
        console.error('❌ [EVENTS] Error obteniendo eventos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear nuevo evento - ASIGNAR CLUB_ID
app.post('/api/events', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden crear eventos' });
        }

        const { title, date, time, type, description, torneo_data } = req.body;
        
        if (!title || !date || !type) {
            return res.status(400).json({ error: 'Título, fecha y tipo son requeridos' });
        }

        const fullDate = time ? `${date}T${time}:00` : date;

        const result = await pool.query(
            `INSERT INTO events (title, date, type, description, torneo_data, created_by, club_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title, fullDate, type, description, torneo_data || null, req.user.id, req.user.club_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creando evento:', err);
        res.status(500).json({ error: 'Error creando evento' });
    }
});

// Actualizar evento
app.put('/api/events/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden editar eventos' });
    }

    const { id } = req.params;
    const { title, date, time, type, description, torneo_data } = req.body;

    // Verificar que el evento existe
    const eventCheck = await pool.query(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );

    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    // Combinar fecha y hora
    const fullDate = time ? `${date}T${time}:00` : date;

    const result = await pool.query(
      `UPDATE events 
       SET title = $1, date = $2, type = $3, description = $4, torneo_data = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [title, fullDate, type, description, torneo_data || null, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error actualizando evento:', err);
    res.status(500).json({ error: 'Error actualizando evento' });
  }
});

// Eliminar evento
app.delete('/api/events/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden eliminar eventos' });
    }

    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM events WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json({ message: 'Evento eliminado correctamente' });
  } catch (err) {
    console.error('Error eliminando evento:', err);
    res.status(500).json({ error: 'Error eliminando evento' });
  }
});

// Obtener planificación de una semana específica
app.get('/api/class-plans', authenticateToken, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        const result = await pool.query(`
            SELECT cp.*, u.name as created_by_name
            FROM class_plans cp
            LEFT JOIN users u ON cp.created_by = u.id
            WHERE cp.club_id = $1 
                AND cp.class_date BETWEEN $2 AND $3
            ORDER BY cp.class_date, cp.class_type
        `, [req.user.club_id, start_date, end_date]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo planificación:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Guardar planificación de una clase - ASIGNAR CLUB_ID
app.post('/api/class-plans', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden planificar clases' });
        }
        
        const { class_date, class_type, theme, techniques, drills, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO class_plans (club_id, class_date, class_type, theme, techniques, drills, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (club_id, class_date, class_type) 
            DO UPDATE SET 
                theme = EXCLUDED.theme,
                techniques = EXCLUDED.techniques,
                drills = EXCLUDED.drills,
                notes = EXCLUDED.notes,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [req.user.club_id, class_date, class_type, theme || null, JSON.stringify(techniques || []), drills || null, notes || null, req.user.id]);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error('Error guardando planificación:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Obtener progresión curricular sugerida
app.get('/api/curriculum-suggestions', authenticateToken, async (req, res) => {
    try {
        const { belt_level } = req.query;
        
        // Obtener plantillas del curriculum
        const templates = await pool.query(`
            SELECT * FROM curriculum_templates
            WHERE club_id = $1 AND belt_level = $2
            ORDER BY week_number
        `, [req.user.club_id, belt_level || 'white']);
        
        // Obtener lo que ya se enseñó
        const taught = await pool.query(`
            SELECT technique_id, times_taught, last_taught
            FROM teaching_history
            WHERE club_id = $1
        `, [req.user.club_id]);
        
        res.json({
            templates: templates.rows,
            taught: taught.rows
        });
    } catch (error) {
        console.error('Error obteniendo sugerencias:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener historial de enseñanza
app.get('/api/teaching-history', authenticateToken, async (req, res) => {
    try {
        const { limit } = req.query;
        
        const result = await pool.query(`
            SELECT * FROM teaching_history
            WHERE club_id = $1
            ORDER BY times_taught DESC, last_taught DESC
            LIMIT $2
        `, [req.user.club_id, limit || 50]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener horarios de entrenamiento del club
app.get('/api/training-schedule', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM training_schedule 
            WHERE club_id = $1
            ORDER BY day_order
        `, [req.user.club_id]);
        
        if (result.rows.length === 0) {
            const defaultSchedule = [
                { day: 'Lunes', time: '19:00 - 20:30', class: 'BJJ Fundamental', level: 'Todos', day_order: 1, club_id: req.user.club_id },
                { day: 'Martes', time: '19:00 - 20:30', class: 'BJJ Avanzado', level: 'Azul+', day_order: 2, club_id: req.user.club_id },
                { day: 'Miércoles', time: '19:00 - 20:30', class: 'No-Gi', level: 'Todos', day_order: 3, club_id: req.user.club_id },
                { day: 'Jueves', time: '19:00 - 20:30', class: 'BJJ Competição', level: 'Intermedio+', day_order: 4, club_id: req.user.club_id },
                { day: 'Viernes', time: '18:00 - 19:30', class: 'Open Mat', level: 'Todos', day_order: 5, club_id: req.user.club_id },
                { day: 'Sábado', time: '10:00 - 12:00', class: 'BJJ & Drills', level: 'Todos', day_order: 6, club_id: req.user.club_id }
            ];
            
            for (const schedule of defaultSchedule) {
                await pool.query(`
                    INSERT INTO training_schedule (day, time, class, level, day_order, club_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [schedule.day, schedule.time, schedule.class, schedule.level, schedule.day_order, schedule.club_id]);
            }
            
            return res.json(defaultSchedule);
        }
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo horarios:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Actualizar horarios de entrenamiento
app.put('/api/training-schedule', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden editar horarios' });
        }

        const { schedule } = req.body;
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Eliminar horarios existentes del club
            await client.query('DELETE FROM training_schedule WHERE club_id = $1', [req.user.club_id]);

            // Insertar nuevos horarios
            for (let i = 0; i < schedule.length; i++) {
                const item = schedule[i];
                if (item.day && item.time && item.class && item.level) {
                    await client.query(
                        `INSERT INTO training_schedule (day, time, class, level, day_order, club_id)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [item.day, item.time, item.class, item.level, i + 1, req.user.club_id]
                    );
                }
            }

            await client.query('COMMIT');
            res.json({ 
                message: 'Horarios actualizados correctamente',
                schedule: schedule 
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error actualizando horarios:', err);
        res.status(500).json({ error: 'Error actualizando horarios: ' + err.message });
    }
});

// Función auxiliar para orden de días
function getDayOrder(day) {
  const days = {
    'Lunes': 1,
    'Martes': 2,
    'Miércoles': 3,
    'Jueves': 4,
    'Viernes': 5,
    'Sábado': 6,
    'Domingo': 7
  };
  return days[day] || 8;
}

// ==================== RUTAS DE GESTIÓN DE ALUMNOS ====================

// Obtener todos los miembros del club (alumnos y mestres)
app.get('/api/students', authenticateToken, async (req, res) => {
    try {
        console.log('📥 Solicitud para obtener miembros del club');
        
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const { search, belt, status, type } = req.query;
        
        let query = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.belt, 
                u.role, 
                u.created_at,
                u.phone,
                up.nickname, 
                up.academy, 
                up.profile_picture,
                COALESCE(sa.session_count, 0) as session_count,
                sa.last_session_date,
                sa.status,
                CASE 
                    WHEN u.role = 'master' THEN 'active'
                    WHEN sa.last_session_date IS NULL THEN 'inactive'
                    WHEN sa.last_session_date < CURRENT_DATE - INTERVAL '30 days' THEN 'inactive'
                    WHEN sa.last_session_date < CURRENT_DATE - INTERVAL '7 days' THEN 'irregular'
                    ELSE 'active'
                END as calculated_status
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN student_activity sa ON u.id = sa.user_id
            WHERE u.club_id = $1
        `;
        
        let params = [req.user.club_id];
        let paramCount = 1;

        if (type === 'students') {
            query += ` AND u.role = 'student'`;
        } else if (type === 'masters') {
            query += ` AND u.role = 'master'`;
        }

        if (search && search.trim() !== '') {
            paramCount++;
            query += ` AND (u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (belt && belt !== 'all') {
            paramCount++;
            query += ` AND u.belt = $${paramCount}`;
            params.push(belt);
        }

        if (status && status !== 'all') {
            if (status === 'active') {
                query += ` AND (u.role = 'master' OR (
                    sa.last_session_date >= CURRENT_DATE - INTERVAL '7 days'
                    OR (sa.status = 'active' AND sa.last_session_date IS NOT NULL)
                ))`;
            } else if (status === 'irregular') {
                query += ` AND u.role = 'student' AND (
                    sa.last_session_date < CURRENT_DATE - INTERVAL '7 days' 
                    AND sa.last_session_date >= CURRENT_DATE - INTERVAL '30 days'
                )`;
            } else if (status === 'inactive') {
                query += ` AND u.role = 'student' AND (
                    sa.last_session_date IS NULL 
                    OR sa.last_session_date < CURRENT_DATE - INTERVAL '30 days'
                    OR sa.status = 'inactive'
                )`;
            }
        }

        query += ' ORDER BY u.role DESC, u.name ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Error obteniendo miembros:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Obtener perfil detallado de un alumno (ACTUALIZADA con objetivos)
app.get('/api/students/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const studentId = req.params.id;

        console.log(`📥 Solicitando perfil del alumno ID: ${studentId}`);

        // 1. Obtener información básica del alumno
        const studentResult = await pool.query(`
            SELECT 
                u.id, u.name, u.email, u.belt, u.role, u.created_at,
                up.nickname, up.academy, up.profile_picture,
                sa.session_count, sa.last_session_date, sa.status,
                sa.notes as activity_notes
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN student_activity sa ON u.id = sa.user_id
            WHERE u.id = $1 AND u.role = 'student'
        `, [studentId]);

        if (studentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }

        const student = studentResult.rows[0];

        // 2. Obtener sesiones recientes del alumno
        const sessionsResult = await pool.query(`
            SELECT id, date, techniques, notes, rating, created_at
            FROM training_sessions 
            WHERE user_id = $1 
            ORDER BY date DESC 
            LIMIT 5
        `, [studentId]);

        // 3. Obtener objetivos REALES del alumno - ESTA ES LA PARTE IMPORTANTE
        const objectivesResult = await pool.query(`
            SELECT 
                id, 
                title, 
                description, 
                deadline, 
                completed, 
                completed_at,
                created_at,
                updated_at
            FROM user_objectives 
            WHERE user_id = $1 
            ORDER BY 
                completed ASC,
                deadline ASC NULLS LAST,
                created_at DESC
        `, [studentId]);

        console.log(`📊 Objetivos encontrados para ${student.name}: ${objectivesResult.rows.length}`);

        // 4. Calcular estado del alumno
        let calculatedStatus = 'active';
        if (!student.last_session_date) {
            calculatedStatus = 'inactive';
        } else {
            const lastSession = new Date(student.last_session_date);
            const daysSinceLastSession = Math.floor((new Date() - lastSession) / (1000 * 60 * 60 * 24));
            
            if (daysSinceLastSession > 30) {
                calculatedStatus = 'inactive';
            } else if (daysSinceLastSession > 7) {
                calculatedStatus = 'irregular';
            }
        }

        // 5. Preparar respuesta
        const studentData = {
            ...student,
            calculated_status: calculatedStatus,
            recent_sessions: sessionsResult.rows,
            objectives: objectivesResult.rows  // ✅ Objetivos REALES
        };

        console.log(`✅ Perfil cargado: ${student.name}, ${sessionsResult.rows.length} sesiones, ${objectivesResult.rows.length} objetivos`);
        res.json(studentData);

    } catch (error) {
        console.error('❌ Error obteniendo perfil de alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// En server.js - Ruta de diagnóstico para objetivos
app.get('/api/debug/objectives/:studentId', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.studentId;
        
        console.log('🔍 DIAGNÓSTICO OBJETIVOS para alumno:', studentId);
        
        // Verificar si el alumno existe
        const studentCheck = await pool.query('SELECT id, name FROM users WHERE id = $1', [studentId]);
        if (studentCheck.rows.length === 0) {
            return res.json({ error: 'Alumno no encontrado', studentId });
        }
        
        // Verificar objetivos en la base de datos
        const objectivesResult = await pool.query(`
            SELECT id, title, description, deadline, completed, completed_at, created_at
            FROM user_objectives 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [studentId]);
        
        console.log(`📊 Objetivos encontrados: ${objectivesResult.rows.length}`);
        
        res.json({
            student: studentCheck.rows[0],
            objectives: objectivesResult.rows,
            query: 'SELECT * FROM user_objectives WHERE user_id = ' + studentId
        });
        
    } catch (error) {
        console.error('Error en diagnóstico:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener todas las sesiones de un alumno específico
app.get('/api/students/:id/sessions', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const studentId = req.params.id;
        const { limit } = req.query;

        let query = `
            SELECT id, date, techniques, notes, rating, created_at
            FROM training_sessions 
            WHERE user_id = $1 
            ORDER BY date DESC
        `;
        
        let params = [studentId];
        
        if (limit) {
            query += ' LIMIT $2';
            params.push(parseInt(limit));
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo sesiones del alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo alumno
app.post('/api/students', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden crear alumnos' });
        }

        const { name, email, password, belt, phone, start_date } = req.body;

        // Validaciones básicas
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Email no válido' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar si el email ya existe
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Hash de la contraseña
            const hashedPassword = await bcrypt.hash(password, 10);

            // Crear usuario
            const result = await client.query(
                `INSERT INTO users (name, email, password, belt, role, phone) 
                 VALUES ($1, $2, $3, $4, 'student', $5) 
                 RETURNING id, name, email, belt, role, created_at, phone`,
                [name, email, hashedPassword, belt || 'white', phone || null]
            );

            const newStudent = result.rows[0];

            // Crear perfil de estudiante
            await client.query(
                `INSERT INTO student_activity (user_id, session_count, status, last_session_date) 
                 VALUES ($1, $2, $3, $4)`,
                [newStudent.id, 0, 'active', start_date || new Date()]
            );

            // Crear perfil de usuario
            await client.query(
                `INSERT INTO user_profiles (user_id, academy) 
                 VALUES ($1, $2)`,
                [newStudent.id, 'JIUJITSU CLUBE']
            );

            await client.query('COMMIT');

            res.status(201).json({
                message: 'Alumno creado exitosamente',
                student: {
                    ...newStudent,
                    session_count: 0,
                    status: 'active',
                    activity_notes: null,
                    objectives: null
                }
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error creando alumno:', error);
        
        if (error.code === '23505') {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==============================================
// ACTUALIZAR ALUMNO (incluye cambio de rol) - VERSIÓN CORREGIDA
// ==============================================
app.put('/api/students/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden editar alumnos' });
        }

        const studentId = req.params.id;
        const { name, email, belt, role, phone } = req.body;

        console.log('✏️ Actualizando usuario:', { studentId, name, email, belt, role, phone });

        await client.query('BEGIN');

        // 1. Verificar que el usuario existe y pertenece al mismo club
        const userCheck = await client.query(
            'SELECT * FROM users WHERE id = $1 AND club_id = $2',
            [studentId, req.user.club_id]
        );

        if (userCheck.rows.length === 0) {
            throw new Error('Usuario no encontrado o no pertenece a tu club');
        }

        const oldUserData = userCheck.rows[0];
        const oldRole = oldUserData.role;

        // 2. Actualizar usuario - SIN updated_at
        await client.query(
            `UPDATE users 
             SET name = COALESCE($1, name),
                 email = COALESCE($2, email),
                 belt = COALESCE($3, belt),
                 role = COALESCE($4, role),
                 phone = COALESCE($5, phone)
             WHERE id = $6`,
            [name, email, belt, role, phone, studentId]
        );

        // 3. Si el rol cambió de student a master
        if (oldRole === 'student' && role === 'master') {
            console.log('👑 Promoviendo alumno a mestre');
            
            // Eliminar de student_activity si existe
            await client.query(
                'DELETE FROM student_activity WHERE user_id = $1',
                [studentId]
            );
            
            // Crear perfil de usuario si no existe
            await client.query(
                `INSERT INTO user_profiles (user_id, academy)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id) DO NOTHING`,
                [studentId, 'JIUJITSU CLUBE']
            );
        }

        // 4. Si el rol cambió de master a student
        if (oldRole === 'master' && role === 'student') {
            console.log('📝 Cambiando mestre a alumno');
            
            // Crear actividad de estudiante
            await client.query(
                `INSERT INTO student_activity (user_id, session_count, status, last_session_date)
                 VALUES ($1, 0, 'active', NULL)
                 ON CONFLICT (user_id) DO NOTHING`,
                [studentId]
            );
        }

        // 5. Actualizar o crear perfil de usuario
        await client.query(
            `INSERT INTO user_profiles (user_id, academy)
             VALUES ($1, $2)
             ON CONFLICT (user_id) 
             DO UPDATE SET academy = EXCLUDED.academy`,
            [studentId, 'JIUJITSU CLUBE']
        );

        await client.query('COMMIT');

        // 6. Obtener el usuario actualizado
        const updatedUser = await client.query(`
            SELECT 
                u.id, u.name, u.email, u.belt, u.role, u.phone, u.created_at,
                up.nickname, up.academy, up.profile_picture,
                COALESCE(sa.session_count, 0) as session_count,
                sa.last_session_date,
                sa.status
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN student_activity sa ON u.id = sa.user_id
            WHERE u.id = $1
        `, [studentId]);

        console.log('✅ Usuario actualizado correctamente:', updatedUser.rows[0]);

        res.json({ 
            message: 'Usuario actualizado exitosamente',
            user: updatedUser.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    } finally {
        client.release();
    }
});

// Eliminar alumno
app.delete('/api/students/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden eliminar alumnos' });
        }

        const studentId = req.params.id;

        // Verificar que el usuario existe y es un alumno
        const userResult = await pool.query(
            'SELECT id, role FROM users WHERE id = $1',
            [studentId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }

        if (userResult.rows[0].role !== 'student') {
            return res.status(400).json({ error: 'Solo se pueden eliminar alumnos' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Eliminar registros relacionados
            await client.query('DELETE FROM student_activity WHERE user_id = $1', [studentId]);
            await client.query('DELETE FROM user_profiles WHERE user_id = $1', [studentId]);
            await client.query('DELETE FROM user_objectives WHERE user_id = $1', [studentId]);
            await client.query('DELETE FROM training_sessions WHERE user_id = $1', [studentId]);
            
            // Eliminar usuario
            await client.query('DELETE FROM users WHERE id = $1', [studentId]);

            await client.query('COMMIT');

            res.json({ message: 'Alumno eliminado exitosamente' });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error eliminando alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Función para generar alertas automáticas
async function generateAutomaticAlerts(client) {
    const alerts = [];

    try {
        // Alerta: Alumnos inactivos por más de 30 días
        const inactiveStudents = await client.query(`
            SELECT u.name, u.id, sa.last_session_date
            FROM users u
            LEFT JOIN student_activity sa ON u.id = sa.user_id
            WHERE u.role = 'student' 
            AND (sa.last_session_date IS NULL OR NOW() - sa.last_session_date > INTERVAL '30 days')
            LIMIT 5
        `);

        inactiveStudents.rows.forEach(student => {
            const daysInactive = student.last_session_date ? 
                Math.floor((new Date() - new Date(student.last_session_date)) / (1000 * 60 * 60 * 24)) : 
                'muchos';
            
            alerts.push({
                type: 'inactivity',
                title: 'Alumno Inactivo',
                message: `${student.name} lleva ${daysInactive} días sin entrenar`,
                student_id: student.id,
                created_at: new Date()
            });
        });

        // Alerta: Sesiones con calificación baja (< 4)
        const lowRatingSessions = await client.query(`
            SELECT ts.rating, ts.notes, u.name, ts.date, ts.user_id
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE ts.rating < 4
            AND ts.date >= NOW() - INTERVAL '7 days'
            ORDER BY ts.date DESC
            LIMIT 3
        `);

        lowRatingSessions.rows.forEach(session => {
            alerts.push({
                type: 'warning',
                title: 'Sesión con baja calificación',
                message: `${session.name} calificó su sesión del ${new Date(session.date).toLocaleDateString()} con ${session.rating}/10`,
                student_id: session.user_id,
                created_at: new Date(session.date)
            });
        });

        // Alerta: Logros recientes (sesiones con calificación alta > 8)
        const highRatingSessions = await client.query(`
            SELECT ts.rating, u.name, ts.date, u.belt, ts.user_id
            FROM training_sessions ts
            JOIN users u ON ts.user_id = u.id
            WHERE ts.rating >= 8
            AND ts.date >= NOW() - INTERVAL '3 days'
            ORDER BY ts.rating DESC, ts.date DESC
            LIMIT 3
        `);

        highRatingSessions.rows.forEach(session => {
            alerts.push({
                type: 'achievement',
                title: 'Buena sesión',
                message: `${session.name} (${getBeltName(session.belt)}) tuvo una excelente sesión: ${session.rating}/10`,
                student_id: session.user_id,
                created_at: new Date(session.date)
            });
        });

    } catch (err) {
        console.error('Error generando alertas:', err);
    }

    return alerts;
}

// Actualizar actividad de alumno (se llama automáticamente cuando crea una sesión)
app.post('/api/students/:id/activity', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Solo mestres pueden actualizar actividad manualmente
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { status, objectives, notes } = req.body;

    // Verificar si ya existe una entrada de actividad
    const existingActivity = await pool.query(
      'SELECT * FROM student_activity WHERE user_id = $1',
      [id]
    );

    if (existingActivity.rows.length > 0) {
      // Actualizar existente
      await pool.query(
        `UPDATE student_activity 
         SET status = $1, objectives = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4`,
        [status, objectives, notes, id]
      );
    } else {
      // Crear nueva
      await pool.query(
        `INSERT INTO student_activity (user_id, status, objectives, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, status, objectives, notes]
      );
    }

    res.json({ message: 'Actividad actualizada correctamente' });
  } catch (err) {
    console.error('Error actualizando actividad:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ==============================================
// SISTEMA DE NOTAS DEL MESTRE
// ==============================================

// Obtener notas de un alumno
app.get('/api/students/:id/notes', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        const { private } = req.query;
        
        let query = `
            SELECT n.*, u.name as master_name
            FROM notes n
            JOIN users u ON n.master_id = u.id
            WHERE n.student_id = $1
        `;
        const params = [studentId];
        
        // Filtrar por tipo de nota
        if (private === 'true') {
            query += ` AND n.is_private = true`;
        } else if (private === 'false') {
            query += ` AND n.is_private = false`;
        }
        
        // Para alumnos, solo ver notas públicas
        if (req.user.role !== 'master') {
            query += ` AND n.is_private = false`;
        }
        
        query += ` ORDER BY n.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error obteniendo notas:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear nueva nota
app.post('/api/students/:id/notes', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden crear notas' });
        }
        
        const studentId = req.params.id;
        const { content, is_private } = req.body;
        
        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'El contenido de la nota es requerido' });
        }
        
        const result = await pool.query(`
            INSERT INTO notes (student_id, master_id, content, is_private)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [studentId, req.user.id, content.trim(), is_private !== false]);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error('Error creando nota:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar nota
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        
        // Verificar que la nota existe y el usuario tiene permisos
        const noteCheck = await pool.query(
            'SELECT * FROM notes WHERE id = $1',
            [noteId]
        );
        
        if (noteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }
        
        const note = noteCheck.rows[0];
        
        // Solo el mestre que creó la nota puede eliminarla
        if (note.master_id !== req.user.id && req.user.role !== 'master') {
            return res.status(403).json({ error: 'No tienes permisos para eliminar esta nota' });
        }
        
        await pool.query('DELETE FROM notes WHERE id = $1', [noteId]);
        res.json({ message: 'Nota eliminada correctamente' });
        
    } catch (error) {
        console.error('Error eliminando nota:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Enviar mensaje privado
app.post('/api/students/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Verificar permisos: mestre o el propio alumno
    if (req.user.role !== 'master' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const isFromMaster = req.user.role === 'master';

    const result = await pool.query(
      `INSERT INTO private_messages (student_id, master_id, message, is_from_master)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, isFromMaster ? req.user.id : null, message, isFromMaster]
    );

    // Para el frontend: si es un alumno enviando, notificar al mestre
    if (!isFromMaster) {
      // Aquí podrías implementar notificaciones push o por email
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear objetivo para alumno
app.post('/api/students/:id/objectives', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden crear objetivos' });
        }

        const studentId = req.params.id;
        const { title, description, deadline } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'El título del objetivo es requerido' });
        }

        const result = await pool.query(
            `INSERT INTO user_objectives (user_id, title, description, deadline) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [studentId, title, description, deadline]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creando objetivo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar objetivo
app.put('/api/objectives/:id', authenticateToken, async (req, res) => {
    try {
        const objectiveId = req.params.id;
        const { title, description, deadline, completed } = req.body;

        // Verificar que el objetivo existe
        const objectiveCheck = await pool.query(
            'SELECT * FROM user_objectives WHERE id = $1',
            [objectiveId]
        );

        if (objectiveCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Objetivo no encontrado' });
        }

        const completedAt = completed ? new Date() : null;

        const result = await pool.query(
            `UPDATE user_objectives 
             SET title = $1, description = $2, deadline = $3, completed = $4, 
                 completed_at = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 RETURNING *`,
            [title, description, deadline, completed, completedAt, objectiveId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error actualizando objetivo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar objetivo
app.delete('/api/objectives/:id', authenticateToken, async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const userId = req.user.id;

    console.log('🗑️ Eliminando objetivo:');
    console.log('   - Objective ID:', objectiveId);
    console.log('   - User ID:', userId);

    // Convertir ID
    let parsedId;
    try {
      parsedId = parseInt(objectiveId);
      if (isNaN(parsedId)) {
        parsedId = objectiveId;
      }
    } catch (e) {
      parsedId = objectiveId;
    }

    // Verificar que el objetivo existe
    const objectiveCheck = await pool.query(
      `SELECT id, title 
       FROM user_objectives 
       WHERE id = $1 AND user_id = $2`,
      [parsedId, userId]
    );

    if (objectiveCheck.rows.length === 0) {
      console.log('❌ Objetivo no encontrado');
      return res.status(404).json({ error: 'Objetivo no encontrado' });
    }

    const objective = objectiveCheck.rows[0];
    console.log('🔍 Objetivo a eliminar:', objective.title);

    // Eliminar el objetivo
    await pool.query(
      `DELETE FROM user_objectives 
       WHERE id = $1 AND user_id = $2`,
      [parsedId, userId]
    );

    console.log('✅ Objetivo eliminado correctamente');
    res.json({ 
      success: true, 
      message: 'Objetivo eliminado correctamente',
      objective: {
        id: parsedId,
        title: objective.title
      }
    });

  } catch (err) {
    console.error('❌ Error eliminando objetivo:', err);
    res.status(500).json({ 
      error: 'Error del servidor',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Marcar objetivo como completado - USANDO user_objectives
app.put('/api/objectives/:id/complete', authenticateToken, async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const userId = req.user.id;

    console.log('✅ Marcando objetivo como completado:');
    console.log('   - Objective ID:', objectiveId);
    console.log('   - User ID:', userId);

    // Convertir ID si es necesario (igual que en el GET)
    let parsedId;
    try {
      parsedId = parseInt(objectiveId);
      if (isNaN(parsedId)) {
        parsedId = objectiveId;
      }
    } catch (e) {
      parsedId = objectiveId;
    }

    // Verificar que el objetivo existe
    const objectiveCheck = await pool.query(
      `SELECT id, title, completed 
       FROM user_objectives 
       WHERE id = $1 AND user_id = $2`,
      [parsedId, userId]
    );

    if (objectiveCheck.rows.length === 0) {
      console.log('❌ Objetivo no encontrado');
      return res.status(404).json({ error: 'Objetivo no encontrado' });
    }

    const objective = objectiveCheck.rows[0];
    console.log('🔍 Objetivo actual:', objective);

    // Solo actualizar si no está ya completado
    if (objective.completed) {
      console.log('⚠️ Objetivo ya está completado');
      return res.status(400).json({ error: 'El objetivo ya está completado' });
    }

    // Actualizar como completado
    const result = await pool.query(
      `UPDATE user_objectives 
       SET completed = true, 
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [parsedId, userId]
    );

    console.log('✅ Objetivo marcado como completado:', result.rows[0]);
    res.json(result.rows[0]);

  } catch (err) {
    console.error('❌ Error completando objetivo:', err);
    res.status(500).json({ 
      error: 'Error del servidor',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// OBTENER USUARIOS CON LOS QUE SE COMPARTIÓ UN GAME PLAN - FILTRADOS POR CLUB
app.get('/api/gameplans/:id/shared-users', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('🔍 Obteniendo usuarios compartidos para Game Plan:', id);
        
        // Verificar que el game plan existe y el usuario es el dueño
        const gameplanCheck = await pool.query(
            'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2 AND club_id = $3',
            [id, req.user.id, req.user.club_id]
        );
        
        if (gameplanCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado o no eres el dueño' });
        }
        
        // Obtener usuarios con los que se compartió (solo del mismo club)
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.belt
            FROM gameplan_shares gs
            JOIN users u ON gs.to_user_id = u.id
            WHERE gs.gameplan_id = $1 AND u.club_id = $2
            ORDER BY u.name
        `, [id, req.user.club_id]);
        
        console.log(`✅ ${result.rows.length} usuarios compartidos encontrados en el club`);
        res.json(result.rows);
        
    } catch (err) {
        console.error('Error obteniendo usuarios compartidos:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// REVOCAR ACCESO A UN GAME PLAN - VERIFICAR MISMO CLUB
app.post('/api/gameplans/:id/revoke-share', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { user_id } = req.body;
        
        console.log('🔒 Revocando acceso al Game Plan:', id, 'para usuario:', user_id);
        
        // Verificar que el game plan existe y el usuario es el dueño
        const gameplanCheck = await pool.query(
            'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2 AND club_id = $3',
            [id, req.user.id, req.user.club_id]
        );
        
        if (gameplanCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Game Plan no encontrado o no eres el dueño' });
        }
        
        // Verificar que el usuario pertenece al mismo club
        const userCheck = await pool.query(
            'SELECT id FROM users WHERE id = $1 AND club_id = $2',
            [user_id, req.user.club_id]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado en tu academia' });
        }
        
        // Eliminar el acceso
        await pool.query(
            'DELETE FROM gameplan_shares WHERE gameplan_id = $1 AND to_user_id = $2',
            [id, user_id]
        );
        
        console.log('✅ Acceso revocado correctamente');
        res.json({ message: 'Acceso revocado correctamente' });
        
    } catch (err) {
        console.error('Error revocando acceso:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener todos los usuarios del club (para compartir)
app.get('/api/club/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, belt, role 
             FROM users 
             WHERE club_id = $1 AND id != $2    
             ORDER BY name`,
            [req.user.club_id, req.user.id]
        );
        
        res.json(result.rows);
    } catch (err) {
        console.error('Error obteniendo miembros del club:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Marcar objetivo como pendiente (deshacer completado)
app.put('/api/objectives/:id/pending', authenticateToken, async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const userId = req.user.id;

    console.log('🔄 Marcando objetivo como pendiente:');
    console.log('   - Objective ID:', objectiveId);
    console.log('   - User ID:', userId);

    // Convertir ID
    let parsedId;
    try {
      parsedId = parseInt(objectiveId);
      if (isNaN(parsedId)) {
        parsedId = objectiveId;
      }
    } catch (e) {
      parsedId = objectiveId;
    }

    // Verificar que el objetivo existe
    const objectiveCheck = await pool.query(
      `SELECT id, title, completed 
       FROM user_objectives 
       WHERE id = $1 AND user_id = $2`,
      [parsedId, userId]
    );

    if (objectiveCheck.rows.length === 0) {
      console.log('❌ Objetivo no encontrado');
      return res.status(404).json({ error: 'Objetivo no encontrado' });
    }

    const objective = objectiveCheck.rows[0];
    console.log('🔍 Objetivo actual:', objective);

    // Solo actualizar si está completado
    if (!objective.completed) {
      console.log('⚠️ Objetivo ya está pendiente');
      return res.status(400).json({ error: 'El objetivo ya está pendiente' });
    }

    // Actualizar como pendiente
    const result = await pool.query(
      `UPDATE user_objectives 
       SET completed = false, 
           completed_at = NULL,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [parsedId, userId]
    );

    console.log('✅ Objetivo marcado como pendiente:', result.rows[0]);
    res.json(result.rows[0]);

  } catch (err) {
    console.error('❌ Error marcando objetivo como pendiente:', err);
    res.status(500).json({ 
      error: 'Error del servidor',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Esta función se llama desde el endpoint de creación de sesiones
async function updateStudentActivity(userId) {
  try {
    const now = new Date();
    
    // Verificar si ya existe una entrada de actividad
    const existingActivity = await pool.query(
      'SELECT * FROM student_activity WHERE user_id = $1',
      [userId]
    );

    if (existingActivity.rows.length > 0) {
      // Actualizar existente
      await pool.query(
        `UPDATE student_activity 
         SET last_session_date = $1, session_count = session_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [now, userId]
      );
    } else {
      // Crear nueva
      await pool.query(
        `INSERT INTO student_activity (user_id, last_session_date, session_count)
         VALUES ($1, $2, 1)`,
        [userId, now]
      );
    }
  } catch (err) {
    console.error('Error actualizando actividad del alumno:', err);
  }
}

// Obtener un miembro específico (alumno o mestre)
app.get('/api/members/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const memberId = req.params.id;

        const memberResult = await pool.query(`
            SELECT 
                u.id, u.name, u.email, u.belt, u.role, u.created_at, u.phone,
                up.nickname, up.academy, up.profile_picture
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.id = $1 AND u.club_id = $2
        `, [memberId, req.user.club_id]);

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Miembro no encontrado' });
        }

        const member = memberResult.rows[0];
        res.json(member);
        
    } catch (error) {
        console.error('Error obteniendo miembro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para actualizar perfil de usuario
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, nickname, belt } = req.body;
        
        const result = await pool.query(
            'UPDATE users SET name = $1, belt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [name, belt, req.user.id]
        );
        
        // Guardar nickname en una tabla de profile si existe
        // Por ahora lo guardamos en una columna adicional si la tienes,
        // o podrías crear una tabla user_profiles
        
        res.json({
            message: 'Perfil actualizado correctamente',
            user: result.rows[0]
        });
    } catch (err) {
        console.error('Error actualizando perfil:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Ruta para cambiar contraseña
app.put('/api/profile/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }
        
        // Verificar contraseña actual
        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        
        if (!validPassword) {
            return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        }
        
        // Hashear nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        
        res.json({ message: 'Contraseña actualizada correctamente' });
    } catch (err) {
        console.error('Error cambiando contraseña:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar sesión
app.put('/api/training-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, techniques, notes, rating } = req.body;
    
    console.log('Actualizando sesión:', { id, date, techniques, notes, rating }); // ← Para debug
    
    // Verificar que la sesión existe y pertenece al usuario
    const sessionCheck = await pool.query(
      'SELECT * FROM training_sessions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    // Convertir técnicas a array si viene como string
    let techniquesArray = techniques;
    if (typeof techniques === 'string') {
      techniquesArray = techniques.split(',').map(tech => tech.trim()).filter(tech => tech.length > 0);
    }
    
    // Validar rating
    if (rating && (rating < 1 || rating > 10)) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 10' });
    }
    
    const result = await pool.query(
      `UPDATE training_sessions 
       SET date = $1, techniques = $2, notes = $3, rating = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [date, techniquesArray, notes, rating, id]
    );
    
    console.log('Sesión actualizada correctamente:', result.rows[0]); // ← Para debug
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error detallado al actualizar sesión:', err); // ← Log detallado
    res.status(500).json({ 
      error: 'Error actualizando sesión',
      details: err.message 
    });
  }
});

// Eliminar sesión
app.delete('/api/training-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar que la sesión existe y pertenece al usuario
    const sessionCheck = await pool.query(
      'SELECT * FROM training_sessions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    await pool.query('DELETE FROM training_sessions WHERE id = $1', [id]);
    res.json({ message: 'Sesión eliminada correctamente' });
  } catch (err) {
    console.error('Error eliminando sesión:', err);
    res.status(500).json({ error: 'Error eliminando sesión' });
  }
});

// ==================== RUTAS COMPLETAS PARA OBJETIVOS DEL USUARIO ====================

// Obtener todos los objetivos del usuario actual
app.get('/api/user/objectives', authenticateToken, async (req, res) => {
    try {
        console.log('📥 Obteniendo objetivos para usuario:', req.user.id);
        
        const result = await pool.query(`
            SELECT 
                id, 
                title, 
                description, 
                deadline, 
                completed, 
                completed_at,
                created_at, 
                updated_at
            FROM user_objectives 
            WHERE user_id = $1 
            ORDER BY 
                completed ASC,
                deadline ASC NULLS LAST,
                created_at DESC
        `, [req.user.id]);

        console.log(`✅ ${result.rows.length} objetivos encontrados para usuario ${req.user.id}`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Error obteniendo objetivos del usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener objetivo específico del usuario
app.get('/api/user/objectives/:id', authenticateToken, async (req, res) => {
    try {
        const objectiveId = req.params.id;
        const userId = req.user.id;
        
        console.log('📥 Obteniendo objetivo específico:');
        console.log('   - Objective ID:', objectiveId);
        console.log('   - User ID:', userId);
        console.log('   - Tipo de objectiveId:', typeof objectiveId);
        console.log('   - Tipo de userId:', typeof userId);
        
        // VALIDACIÓN ROBUSTA de parámetros
        if (!objectiveId || objectiveId === 'undefined' || objectiveId === 'null') {
            console.error('❌ Error: objectiveId es inválido:', objectiveId);
            return res.status(400).json({ 
                error: 'ID de objetivo inválido',
                received: objectiveId 
            });
        }
        
        if (!userId) {
            console.error('❌ Error: userId es inválido');
            return res.status(400).json({ error: 'Usuario no autenticado' });
        }
        
        // Convertir objectiveId a número si es posible
        let parsedId;
        try {
            parsedId = parseInt(objectiveId);
            if (isNaN(parsedId)) {
                console.warn('⚠️ objectiveId no es numérico, usando como string');
                parsedId = objectiveId;
            }
        } catch (e) {
            console.warn('⚠️ Error parseando ID, usando como string:', e.message);
            parsedId = objectiveId;
        }
        
        console.log('🔍 Ejecutando consulta SQL con:');
        console.log('   - parsedId:', parsedId, '(tipo:', typeof parsedId, ')');
        console.log('   - userId:', userId, '(tipo:', typeof userId, ')');
        
        const result = await pool.query(`
            SELECT 
                id, 
                title, 
                description, 
                deadline, 
                completed, 
                completed_at,
                created_at, 
                updated_at
            FROM user_objectives 
            WHERE id = $1 AND user_id = $2
        `, [parsedId, userId]);

        console.log('📊 Resultado de la consulta:');
        console.log('   - Filas encontradas:', result.rows.length);
        
        if (result.rows.length === 0) {
            console.log('❌ Objetivo no encontrado en BD');
            return res.status(404).json({ 
                error: 'Objetivo no encontrado',
                objectiveId: parsedId,
                userId: userId
            });
        }

        console.log('✅ Objetivo encontrado en BD:', result.rows[0]);
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('❌ Error detallado obteniendo objetivo:');
        console.error('   - Mensaje:', error.message);
        console.error('   - Código:', error.code);
        console.error('   - Detalle:', error.detail);
        console.error('   - Stack:', error.stack);
        
        // Manejar error específico de PostgreSQL
        if (error.code === '22P02') {
            return res.status(400).json({ 
                error: 'ID de objetivo inválido',
                message: 'El ID debe ser un número válido',
                code: error.code
            });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Crear nuevo objetivo para el usuario actual
app.post('/api/user/objectives', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { title, description, deadline } = req.body;
        console.log('📝 Creando objetivo para usuario:', req.user.id, 'Datos:', { title, description, deadline });

        // Validaciones más robustas
        if (!title || title.trim() === '') {
            console.log('❌ Validación fallida: título vacío');
            return res.status(400).json({ error: 'El título del objetivo es requerido' });
        }

        if (title.length > 100) {
            return res.status(400).json({ error: 'El título no puede tener más de 100 caracteres' });
        }

        // Validar y formatear fecha
        let formattedDeadline = null;
        if (deadline && deadline.trim() !== '') {
            const date = new Date(deadline);
            if (isNaN(date.getTime())) {
                console.log('❌ Fecha inválida:', deadline);
                return res.status(400).json({ error: 'Fecha no válida' });
            }
            formattedDeadline = date.toISOString().split('T')[0];
            console.log('📅 Fecha formateada:', formattedDeadline);
        }

        await client.query('BEGIN');

        console.log('🗄️ Ejecutando INSERT en user_objectives...');
        const result = await client.query(
            `INSERT INTO user_objectives (user_id, title, description, deadline) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, title, description, deadline, completed, completed_at, created_at`,
            [
                req.user.id, 
                title.trim(), 
                description ? description.trim() : null, 
                formattedDeadline
            ]
        );

        await client.query('COMMIT');

        const newObjective = result.rows[0];
        console.log('✅ Objetivo creado exitosamente en BD:', newObjective);
        
        res.status(201).json(newObjective);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en creación de objetivo:', error);
        
        // Manejar errores específicos de PostgreSQL
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe un objetivo con ese título' });
        }
        
        if (error.code === '23503') {
            return res.status(400).json({ error: 'Usuario no válido' });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
});

// Actualizar objetivo del usuario actual
app.put('/api/user/objectives/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const objectiveId = req.params.id;
        const { title, description, deadline, completed } = req.body;

        console.log('✏️ Actualizando objetivo:', {
            objectiveId,
            title,
            description,
            deadline,
            completed,
            userId: req.user.id
        });

        // Verificar que el objetivo existe y pertenece al usuario
        const objectiveCheck = await client.query(
            'SELECT * FROM user_objectives WHERE id = $1 AND user_id = $2',
            [objectiveId, req.user.id]
        );

        if (objectiveCheck.rows.length === 0) {
            console.log('❌ Objetivo no encontrado para actualizar:', objectiveId);
            return res.status(404).json({ error: 'Objetivo no encontrado' });
        }

        const currentObjective = objectiveCheck.rows[0];
        
        // Usar valores actuales si no se proporcionan nuevos
        const updatedTitle = title !== undefined ? title : currentObjective.title;
        const updatedDescription = description !== undefined ? description : currentObjective.description;
        const updatedDeadline = deadline !== undefined ? deadline : currentObjective.deadline;
        const updatedCompleted = completed !== undefined ? completed : currentObjective.completed;

        // Validar título
        if (!updatedTitle || updatedTitle.trim() === '') {
            return res.status(400).json({ error: 'El título del objetivo es requerido' });
        }

        // Validar y formatear fecha
        let formattedDeadline = null;
        if (updatedDeadline && updatedDeadline.trim() !== '') {
            const date = new Date(updatedDeadline);
            if (isNaN(date.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' });
            }
            formattedDeadline = date.toISOString().split('T')[0];
        }

        const completedAt = updatedCompleted ? new Date() : null;

        console.log('📝 Valores finales para actualizar:', {
            updatedTitle,
            updatedDescription,
            formattedDeadline,
            updatedCompleted,
            completedAt
        });

        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE user_objectives 
             SET title = $1, description = $2, deadline = $3, completed = $4, 
                 completed_at = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND user_id = $7 
             RETURNING *`,
            [
                updatedTitle.trim(), 
                updatedDescription ? updatedDescription.trim() : null, 
                formattedDeadline, 
                updatedCompleted, 
                completedAt, 
                objectiveId, 
                req.user.id
            ]
        );

        await client.query('COMMIT');

        const updatedObjective = result.rows[0];
        console.log('✅ Objetivo actualizado correctamente:', updatedObjective);
        
        res.json(updatedObjective);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error actualizando objetivo:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message 
        });
    } finally {
        client.release();
    }
});

// Eliminar objetivo del usuario actual
app.delete('/api/user/objectives/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const objectiveId = req.params.id;
        console.log('🗑️ Eliminando objetivo ID:', objectiveId, 'para usuario:', req.user.id);

        // Verificar que el objetivo existe y pertenece al usuario
        const objectiveCheck = await client.query(
            'SELECT * FROM user_objectives WHERE id = $1 AND user_id = $2',
            [objectiveId, req.user.id]
        );

        if (objectiveCheck.rows.length === 0) {
            console.log('❌ Objetivo no encontrado para eliminar:', objectiveId);
            return res.status(404).json({ error: 'Objetivo no encontrado' });
        }

        await client.query('BEGIN');

        const result = await client.query(
            'DELETE FROM user_objectives WHERE id = $1 AND user_id = $2 RETURNING *',
            [objectiveId, req.user.id]
        );

        await client.query('COMMIT');

        const deletedObjective = result.rows[0];
        console.log('✅ Objetivo eliminado:', deletedObjective);
        
        res.json({ 
            message: 'Objetivo eliminado correctamente',
            deletedObjective: deletedObjective
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error eliminando objetivo:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message 
        });
    } finally {
        client.release();
    }
});

// Marcar objetivo como completado/incompleto
app.patch('/api/user/objectives/:id/toggle', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const objectiveId = req.params.id;
        console.log('🔄 Cambiando estado del objetivo:', objectiveId);

        // Verificar que el objetivo existe y pertenece al usuario
        const objectiveCheck = await client.query(
            'SELECT * FROM user_objectives WHERE id = $1 AND user_id = $2',
            [objectiveId, req.user.id]
        );

        if (objectiveCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Objetivo no encontrado' });
        }

        const currentObjective = objectiveCheck.rows[0];
        const newCompletedStatus = !currentObjective.completed;
        const completedAt = newCompletedStatus ? new Date() : null;

        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE user_objectives 
             SET completed = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND user_id = $4 
             RETURNING *`,
            [newCompletedStatus, completedAt, objectiveId, req.user.id]
        );

        await client.query('COMMIT');

        const updatedObjective = result.rows[0];
        console.log('✅ Estado del objetivo actualizado:', updatedObjective);
        
        res.json(updatedObjective);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error cambiando estado del objetivo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// Obtener todas las competencias del club
app.get('/api/competitions', authenticateToken, async (req, res) => {
    try {
        const { status, year } = req.query;
        
        let query = `
            SELECT c.*, 
                   COUNT(DISTINCT cp.id) as participants_count,
                   COUNT(DISTINCT ce.id) as expenses_count,
                   COALESCE(SUM(ce.amount), 0) as total_expenses,
                   COUNT(DISTINCT cp.id) FILTER (WHERE cp.result IN ('oro', 'plata', 'bronce')) as medals_count
            FROM competitions c
            LEFT JOIN competition_participants cp ON c.id = cp.competition_id
            LEFT JOIN competition_expenses ce ON c.id = ce.competition_id
            WHERE c.club_id = $1
        `;
        
        const params = [req.user.club_id];
        let paramCount = 1;
        
        if (status && status !== 'all') {
            paramCount++;
            query += ` AND c.status = $${paramCount}`;
            params.push(status);
        }
        
        if (year && year !== 'all') {
            paramCount++;
            query += ` AND EXTRACT(YEAR FROM c.event_date) = $${paramCount}`;
            params.push(year);
        }
        
        query += ` GROUP BY c.id ORDER BY c.event_date DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Error obteniendo competencias:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener una competencia específica
app.get('/api/competitions/:id', authenticateToken, async (req, res) => {
    try {
        const competitionId = req.params.id;
        
        // Datos de la competencia
        const competitionResult = await pool.query(`
            SELECT c.*, u.name as created_by_name
            FROM competitions c
            LEFT JOIN users u ON c.created_by = u.id
            WHERE c.id = $1 AND c.club_id = $2
        `, [competitionId, req.user.club_id]);
        
        if (competitionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Competencia no encontrada' });
        }
        
        const competition = competitionResult.rows[0];
        
        // Participantes
        const participantsResult = await pool.query(`
            SELECT cp.*, u.name, u.belt, u.email
            FROM competition_participants cp
            JOIN users u ON cp.user_id = u.id
            WHERE cp.competition_id = $1
            ORDER BY cp.result DESC, u.name
        `, [competitionId]);
        
        // Gastos
        const expensesResult = await pool.query(`
            SELECT ce.*, u.name as paid_by_name
            FROM competition_expenses ce
            LEFT JOIN users u ON ce.paid_by = u.id
            WHERE ce.competition_id = $1
            ORDER BY ce.expense_date DESC
        `, [competitionId]);
        
        // Fotos
        const photosResult = await pool.query(`
            SELECT cp.*, u.name as uploaded_by_name
            FROM competition_photos cp
            LEFT JOIN users u ON cp.uploaded_by = u.id
            WHERE cp.competition_id = $1
            ORDER BY cp.uploaded_at DESC
        `, [competitionId]);
        
        res.json({
            ...competition,
            participants: participantsResult.rows,
            expenses: expensesResult.rows,
            photos: photosResult.rows
        });
        
    } catch (error) {
        console.error('Error obteniendo competencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear nueva competencia - ASIGNAR CLUB_ID
app.post('/api/competitions', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden crear competencias' });
        }
        
        const { name, event_date, location, organizer, website, registration_deadline, registration_fee, category, status, notes } = req.body;
        
        if (!name || !event_date) {
            return res.status(400).json({ error: 'Nombre y fecha son requeridos' });
        }
        
        const result = await pool.query(`
            INSERT INTO competitions 
            (club_id, name, event_date, location, organizer, website, registration_deadline, registration_fee, category, status, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [req.user.club_id, name, event_date, location, organizer, website, registration_deadline, registration_fee, category, status || 'upcoming', notes, req.user.id]);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error('Error creando competencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar competencia
app.put('/api/competitions/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden editar competencias' });
        }
        
        const competitionId = req.params.id;
        const { name, event_date, location, organizer, website, registration_deadline, registration_fee, category, status, notes } = req.body;
        
        const result = await pool.query(`
            UPDATE competitions 
            SET name = $1, event_date = $2, location = $3, organizer = $4, 
                website = $5, registration_deadline = $6, registration_fee = $7, 
                category = $8, status = $9, notes = $10, updated_at = CURRENT_TIMESTAMP
            WHERE id = $11 AND club_id = $12
            RETURNING *
        `, [name, event_date, location, organizer, website, registration_deadline, registration_fee, category, status, notes, competitionId, req.user.club_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Competencia no encontrada' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Error actualizando competencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar competencia
app.delete('/api/competitions/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden eliminar competencias' });
        }
        
        const competitionId = req.params.id;
        
        await client.query('BEGIN');
        
        // Eliminar dependencias
        await client.query('DELETE FROM competition_photos WHERE competition_id = $1', [competitionId]);
        await client.query('DELETE FROM competition_expenses WHERE competition_id = $1', [competitionId]);
        await client.query('DELETE FROM competition_participants WHERE competition_id = $1', [competitionId]);
        await client.query('DELETE FROM competitions WHERE id = $1 AND club_id = $2', [competitionId, req.user.club_id]);
        
        await client.query('COMMIT');
        
        res.json({ message: 'Competencia eliminada correctamente' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error eliminando competencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Agregar participante a competencia - VERSIÓN MEJORADA
app.post('/api/competitions/:id/participants', authenticateToken, async (req, res) => {
    try {
        const competitionId = req.params.id;
        const { user_id, category_weight, category_age, belt_at_competition, gi_mode, gender, age_category, weight_category } = req.body;
        
        // Verificar que el competidor existe y es alumno
        const userCheck = await pool.query(
            'SELECT id, name, belt FROM users WHERE id = $1 AND role = $2',
            [user_id, 'student']
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }
        
        const result = await pool.query(`
            INSERT INTO competition_participants 
            (competition_id, user_id, category_weight, category_age, belt_at_competition, gi_mode, gender, age_category, weight_category, registered_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (competition_id, user_id) DO UPDATE SET
                category_weight = EXCLUDED.category_weight,
                category_age = EXCLUDED.category_age,
                belt_at_competition = EXCLUDED.belt_at_competition,
                gi_mode = EXCLUDED.gi_mode,
                gender = EXCLUDED.gender,
                age_category = EXCLUDED.age_category,
                weight_category = EXCLUDED.weight_category
            RETURNING *
        `, [competitionId, user_id, category_weight, category_age, belt_at_competition, gi_mode, gender, age_category, weight_category, req.user.id]);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error('Error agregando participante:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// SISTEMA DE PROMOCIONES - CRUD COMPLETO
// ==============================================

// Obtener promociones de un alumno
app.get('/api/students/:id/promotions', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        const result = await pool.query(`
            SELECT p.*, 
                   u.name as granted_by_name,
                   to_char(p.promotion_date, 'DD/MM/YYYY') as formatted_date,
                   EXTRACT(YEAR FROM p.time_in_old_belt) * 12 + EXTRACT(MONTH FROM p.time_in_old_belt) as months_in_old_belt
            FROM promotions p
            LEFT JOIN users u ON p.granted_by = u.id
            WHERE p.user_id = $1
            ORDER BY p.promotion_date DESC
        `, [studentId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo promociones:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ==============================================
// OBTENER SUGERENCIAS DE PROMOCIÓN - VERSIÓN CORREGIDA
// ==============================================
app.get('/api/club/promotion-suggestions', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden ver sugerencias' });
        }
        
        // Obtener todos los alumnos (no negros) con su última fecha de promoción
        const studentsResult = await pool.query(`
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.belt as current_belt,
                u.created_at,
                COALESCE(MAX(p.promotion_date), u.created_at) as last_promotion_date
            FROM users u
            LEFT JOIN promotions p ON u.id = p.user_id
            WHERE u.club_id = $1 AND u.role = 'student' AND u.belt != 'black'
            GROUP BY u.id, u.name, u.email, u.belt, u.created_at
        `, [req.user.club_id]);
        
        const suggestions = [];
        
        // Mapeo de cinturones
        const beltOrder = { 
            'white': { next: 'blue', name: 'Blanco', emoji: '⚪' },
            'blue': { next: 'purple', name: 'Azul', emoji: '🟦' },
            'purple': { next: 'brown', name: 'Púrpura', emoji: '🟪' },
            'brown': { next: 'black', name: 'Marrón', emoji: '🟫' },
            'black': { next: null, name: 'Negro', emoji: '⬛' }
        };
        
        // Para cada alumno, calcular estadísticas por separado
        for (const student of studentsResult.rows) {
            const currentBeltInfo = beltOrder[student.current_belt];
            const nextBeltInfo = currentBeltInfo?.next ? beltOrder[currentBeltInfo.next] : null;
            
            // Contar sesiones desde la última promoción
            const sessionsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM training_sessions ts
                WHERE ts.user_id = $1 AND ts.date >= $2
            `, [student.id, student.last_promotion_date]);
            
            const sessionsCount = parseInt(sessionsResult.rows[0]?.count || 0);
            
            // Calcular meses desde la última promoción
            const lastDate = new Date(student.last_promotion_date);
            const today = new Date();
            let monthsSince = (today.getFullYear() - lastDate.getFullYear()) * 12;
            monthsSince += today.getMonth() - lastDate.getMonth();
            if (monthsSince < 0) monthsSince = 0;
            
            // Obtener parámetros de promoción para este cinturón (solo como referencia, no limitante)
            const paramsResult = await pool.query(`
                SELECT min_months, min_sessions
                FROM promotion_parameters
                WHERE club_id = $1 AND belt_from = $2
            `, [req.user.club_id, student.current_belt]);
            
            const params = paramsResult.rows[0] || { min_months: null, min_sessions: null };
            
            // Determinar readiness (solo informativo, no limitante)
            let readiness = 'pending';
            if (params.min_months && params.min_sessions) {
                if (monthsSince >= params.min_months && sessionsCount >= params.min_sessions) {
                    readiness = 'ready';
                } else if (monthsSince >= params.min_months) {
                    readiness = 'time_ready';
                } else if (sessionsCount >= params.min_sessions) {
                    readiness = 'sessions_ready';
                }
            } else if (params.min_months && monthsSince >= params.min_months) {
                readiness = 'time_ready';
            } else if (params.min_sessions && sessionsCount >= params.min_sessions) {
                readiness = 'sessions_ready';
            }
            
            suggestions.push({
                id: student.id,
                name: student.name,
                email: student.email,
                current_belt: student.current_belt,
                current_belt_name: currentBeltInfo?.name || student.current_belt,
                current_belt_emoji: currentBeltInfo?.emoji || '🥋',
                next_belt_code: currentBeltInfo?.next,
                next_belt_name: nextBeltInfo?.name || 'Negro',
                next_belt_emoji: nextBeltInfo?.emoji || '⬛',
                months_since_last_promotion: monthsSince,
                sessions_since_last_promotion: sessionsCount,
                min_months: params.min_months,
                min_sessions: params.min_sessions,
                readiness_status: readiness
            });
        }
        
        // Ordenar sugerencias: ready primero, luego time_ready, luego sessions_ready
        const orderPriority = { 'ready': 1, 'time_ready': 2, 'sessions_ready': 3, 'pending': 4 };
        suggestions.sort((a, b) => {
            return (orderPriority[a.readiness_status] || 5) - (orderPriority[b.readiness_status] || 5);
        });
        
        res.json(suggestions);
        
    } catch (error) {
        console.error('Error obteniendo sugerencias:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Crear nueva promoción
app.post('/api/students/:id/promotions', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo mestres pueden registrar promociones' });
        }
        
        const studentId = req.params.id;
        const { new_belt, observations, promotion_date } = req.body;
        
        // Obtener cinturón actual del alumno
        const userResult = await pool.query(
            'SELECT belt FROM users WHERE id = $1 AND club_id = $2',
            [studentId, req.user.club_id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }
        
        const old_belt = userResult.rows[0].belt;
        
        // Verificar que el nuevo cinturón es superior
        const beltOrder = { 'white': 1, 'blue': 2, 'purple': 3, 'brown': 4, 'black': 5 };
        if (beltOrder[new_belt] <= beltOrder[old_belt]) {
            return res.status(400).json({ error: 'El nuevo cinturón debe ser superior al actual' });
        }
        
        await client.query('BEGIN');
        
        // Obtener última promoción o fecha de creación
        const lastPromotion = await client.query(`
            SELECT COALESCE(MAX(promotion_date), u.created_at) as last_date,
                   COUNT(ts.id) as sessions_count
            FROM users u
            LEFT JOIN promotions p ON u.id = p.user_id
            LEFT JOIN training_sessions ts ON u.id = ts.user_id 
                AND ts.date >= COALESCE(p.promotion_date, u.created_at)
            WHERE u.id = $1
            GROUP BY u.id
        `, [studentId]);
        
        const lastDate = lastPromotion.rows[0]?.last_date || new Date();
        const sessionsCount = lastPromotion.rows[0]?.sessions_count || 0;
        
        // Calcular tiempo en cinturón anterior
        const timeInOldBelt = await client.query(`
            SELECT AGE($1::date, $2::date) as time_interval
        `, [promotion_date, lastDate]);
        
        // Registrar promoción
        const result = await client.query(`
            INSERT INTO promotions 
            (user_id, club_id, old_belt, new_belt, promotion_date, granted_by, 
             time_in_old_belt, sessions_in_old_belt, observations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [studentId, req.user.club_id, old_belt, new_belt, promotion_date, req.user.id,
            timeInOldBelt.rows[0].time_interval, sessionsCount, observations]);
        
        // Actualizar cinturón del usuario
        await client.query(
            'UPDATE users SET belt = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [new_belt, studentId]
        );
        
        await client.query('COMMIT');
        
        // Crear notificación para el alumno
        await createPromotionNotification(studentId, new_belt, req.user.name);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error registrando promoción:', error);
        res.status(500).json({ error: 'Error del servidor' });
    } finally {
        client.release();
    }
});

// Función auxiliar para crear notificación de promoción
async function createPromotionNotification(userId, newBelt, grantedByName) {
    try {
        const beltNames = { 'white': 'Blanco', 'blue': 'Azul', 'purple': 'Púrpura', 'brown': 'Marrón', 'black': 'Negro' };
        const beltEmoji = { 'white': '⚪', 'blue': '🟦', 'purple': '🟪', 'brown': '🟫', 'black': '⬛' };
        
        await pool.query(`
            INSERT INTO notifications (user_id, title, message, type, related_id)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            userId,
            '🎉 ¡Nueva Promoción!',
            `¡Felicidades! Has sido promovido a ${beltEmoji[newBelt]} Cinturón ${beltNames[newBelt]} por el Mestre ${grantedByName}.`,
            'promotion',
            null
        ]);
    } catch (error) {
        console.error('Error creando notificación:', error);
    }
}

// Actualizar resultado de participante
app.put('/api/competitions/:id/participants/:userId', authenticateToken, async (req, res) => {
    try {
        const { id: competitionId, userId } = req.params;
        const { result, observations, fight_count, win_count, loss_count } = req.body;
        
        const resultDb = await pool.query(`
            UPDATE competition_participants 
            SET result = $1, observations = $2, fight_count = $3, win_count = $4, loss_count = $5
            WHERE competition_id = $6 AND user_id = $7
            RETURNING *
        `, [result, observations, fight_count, win_count, loss_count, competitionId, userId]);
        
        if (resultDb.rows.length === 0) {
            return res.status(404).json({ error: 'Participante no encontrado' });
        }
        
        res.json(resultDb.rows[0]);
        
    } catch (error) {
        console.error('Error actualizando resultado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar participante de competencia
app.delete('/api/competitions/:id/participants/:userId', authenticateToken, async (req, res) => {
    try {
        const { id: competitionId, userId } = req.params;
        
        await pool.query(
            'DELETE FROM competition_participants WHERE competition_id = $1 AND user_id = $2',
            [competitionId, userId]
        );
        
        res.json({ message: 'Participante eliminado' });
        
    } catch (error) {
        console.error('Error eliminando participante:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Agregar gasto a competencia
app.post('/api/competitions/:id/expenses', authenticateToken, async (req, res) => {
    try {
        const competitionId = req.params.id;
        const { concept, amount, expense_date, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO competition_expenses 
            (competition_id, concept, amount, expense_date, paid_by, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [competitionId, concept, amount, expense_date, req.user.id, notes]);
        
        res.status(201).json(result.rows[0]);
        
    } catch (error) {
        console.error('Error agregando gasto:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar gasto
app.delete('/api/competitions/expenses/:expenseId', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM competition_expenses WHERE id = $1', [req.params.expenseId]);
        res.json({ message: 'Gasto eliminado' });
    } catch (error) {
        console.error('Error eliminando gasto:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});
// ==============================================
// CRON JOBS PARA NOTIFICACIONES AUTOMÁTICAS
// ==============================================

// Función para verificar vencimientos y crear notificaciones
async function checkExpiringMemberships() {
    console.log('🔍 Verificando membresías por vencer...');
    
    try {
        // Obtener todas las membresías activas
        const memberships = await pool.query(`
            SELECT m.*, u.id as user_id, u.name, u.email, u.phone,
                   mp.name as plan_name, mp.price,
                   c.id as club_id,
                   ns.reminder_days, ns.reminder_time
            FROM members m
            JOIN users u ON m.user_id = u.id
            JOIN clubs c ON u.club_id = c.id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            LEFT JOIN notification_settings ns ON c.id = ns.club_id
            WHERE m.status = 'active'
        `);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        for (const membership of memberships.rows) {
            const endDate = new Date(membership.end_date);
            endDate.setHours(0, 0, 0, 0);
            
            const daysUntilExpiration = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            
            // Verificar si debemos notificar según los días configurados
            const reminderDays = membership.reminder_days || [7, 3, 1];
            
            for (const days of reminderDays) {
                if (daysUntilExpiration === days) {
                    // Crear notificación programada
                    await createExpirationNotification(membership, daysUntilExpiration);
                }
            }
            
            // Si ya venció y no tiene notificación de vencido
            if (daysUntilExpiration < 0) {
                const existingNotification = await pool.query(
                    `SELECT id FROM scheduled_notifications 
                     WHERE user_id = $1 AND type = 'expired' 
                     AND related_id = $2 AND status = 'pending'`,
                    [membership.user_id, membership.id]
                );
                
                if (existingNotification.rows.length === 0) {
                    await createExpiredNotification(membership);
                }
            }
        }
        
        console.log('✅ Verificación de vencimientos completada');
        
    } catch (error) {
        console.error('Error verificando vencimientos:', error);
    }
}

// Función para crear notificación de próximo vencimiento
async function createExpirationNotification(membership, daysLeft) {
    const title = daysLeft === 0 ? '⏰ ¡Tu membresía vence HOY!' :
                  daysLeft === 1 ? '⚠️ Tu membresía vence MAÑANA' :
                  `📅 Tu membresía vence en ${daysLeft} días`;
    
    const message = daysLeft === 0 ?
        `Hoy vence tu membresía de ${membership.plan_name || 'membresía'}. Realizá el pago para continuar entrenando.` :
        daysLeft === 1 ?
        `Mañana vence tu membresía de ${membership.plan_name || 'membresía'}. No te quedes sin entrenar, renová hoy.` :
        `Tu membresía de ${membership.plan_name || 'membresía'} vence en ${daysLeft} días. Recordá renovar para no interrumpir tus entrenamientos.`;
    
    await pool.query(
        `INSERT INTO scheduled_notifications 
         (user_id, club_id, type, title, message, scheduled_for, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [membership.user_id, membership.club_id, 'reminder', title, message, new Date(), membership.id]
    );
    
    console.log(`✅ Notificación de vencimiento creada para usuario ${membership.user_id}`);
}

// Función para crear notificación de membresía vencida
async function createExpiredNotification(membership) {
    const title = '🔴 Membresía vencida';
    const message = `Tu membresía de ${membership.plan_name || 'membresía'} venció el ${new Date(membership.end_date).toLocaleDateString()}. Regularizá tu situación para seguir entrenando.`;
    
    await pool.query(
        `INSERT INTO scheduled_notifications 
         (user_id, club_id, type, title, message, scheduled_for, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [membership.user_id, membership.club_id, 'expired', title, message, new Date(), membership.id]
    );
    
    // También notificar al mestre
    const masters = await pool.query(
        'SELECT id FROM users WHERE club_id = $1 AND role = $2',
        [membership.club_id, 'master']
    );
    
    for (const master of masters.rows) {
        await pool.query(
            `INSERT INTO scheduled_notifications 
             (user_id, club_id, type, title, message, scheduled_for, related_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [master.id, membership.club_id, 'master_alert', 
             `Alumno con membresía vencida: ${membership.name}`,
             `${membership.name} tiene la membresía vencida desde el ${new Date(membership.end_date).toLocaleDateString()}`,
             new Date(), membership.user_id]
        );
    }
}

// Función para crear notificación de pago registrado
async function createPaymentNotification(paymentId) {
    try {
        const payment = await pool.query(`
            SELECT p.*, u.id as user_id, u.name, mp.name as plan_name,
                   c.id as club_id
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN members m ON u.id = m.user_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            JOIN clubs c ON p.club_id = c.id
            WHERE p.id = $1
        `, [paymentId]);
        
        if (payment.rows.length === 0) return;
        
        const data = payment.rows[0];
        
        // Notificación al alumno
        await pool.query(
            `INSERT INTO scheduled_notifications 
             (user_id, club_id, type, title, message, scheduled_for, related_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [data.user_id, data.club_id, 'payment_confirmation',
             '✅ Pago registrado correctamente',
             `Tu pago de $${parseInt(data.amount).toLocaleString()} por ${data.plan_name || 'membresía'} fue registrado. Período: ${new Date(data.period_start).toLocaleDateString()} al ${new Date(data.period_end).toLocaleDateString()}`,
             new Date(), data.id]
        );
        
        // Notificación al mestre
        const masters = await pool.query(
            'SELECT id FROM users WHERE club_id = $1 AND role = $2',
            [data.club_id, 'master']
        );
        
        for (const master of masters.rows) {
            await pool.query(
                `INSERT INTO scheduled_notifications 
                 (user_id, club_id, type, title, message, scheduled_for, related_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [master.id, data.club_id, 'master_payment',
                 `💰 Pago registrado: ${data.name}`,
                 `${data.name} pagó $${parseInt(data.amount).toLocaleString()} por ${data.plan_name || 'membresía'}`,
                 new Date(), data.id]
            );
        }
        
    } catch (error) {
        console.error('Error creando notificación de pago:', error);
    }
}

// Configurar CRON jobs (ejecutar cada hora)
setInterval(checkExpiringMemberships, 60 * 60 * 1000);

// Ejecutar también al iniciar el servidor
setTimeout(checkExpiringMemberships, 5000);

const PORT = process.env.PORT || 5000;

// Agrega esto ANTES del app.listen para debugging
console.log('🔧 Configuración del servidor:');
console.log('   PORT:', PORT);
console.log('   NODE_ENV:', process.env.NODE_ENV);
console.log('   Database:', process.env.DATABASE_URL ? 'Configurada' : 'No configurada');

// ========== INICIAR SERVIDOR ==========
const HOST = '0.0.0.0'; // Escuchar en todas las interfaces
const LOCAL_IP = getLocalIP();

console.log('🔧 Configuración del servidor:');
console.log('   PORT:', PORT);
console.log('   HOST:', HOST);
console.log('   NODE_ENV:', process.env.NODE_ENV);
console.log('   Database:', process.env.DATABASE_URL ? 'Configurada' : 'No configurada');
console.log('   IP Local:', LOCAL_IP);

// ==================== MANEJO DE ERRORES 404 ====================
const frontendPath = path.join(__dirname, '..', 'frontend');
console.log('📁 Sirviendo frontend desde:', frontendPath);
app.use(express.static(frontendPath));

// Middleware para manejar rutas API no encontradas
app.use('/api/*', (req, res) => {
    console.log(`❌ [404] Ruta API no encontrada: ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Ruta API no encontrada',
        code: 'API_ENDPOINT_NOT_FOUND',
        path: req.path,
        timestamp: new Date().toISOString(),
        suggestion: 'Verifica la URL o consulta la documentación de la API'
    });
});

// Ruta catch-all para SPA (Single Page Application)
app.get('*', (req, res) => {
    // No interferir con rutas de API
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint no encontrado' });
    }
    
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Archivo index.html no encontrado');
    }
});

app.listen(PORT, HOST, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🎯 SERVIDOR BJJ CLUB PLATFORM INICIADO');
    console.log('='.repeat(50));
    console.log('📂 Directorio actual:', __dirname);
    console.log('📁 Frontend path:', frontendPath);
    console.log('🔧 Puerto:', PORT);
    console.log('🌐 IP Local:', LOCAL_IP);
    console.log('🌐 Host:', HOST);
    console.log('');
    console.log('🔗 URLs para probar:');
    console.log('✅ Localhost:      http://localhost:' + PORT);
    console.log('✅ IP Local:       http://' + LOCAL_IP + ':' + PORT);
    console.log('✅ API Test:       http://' + LOCAL_IP + ':' + PORT + '/api/test');
    console.log('');
    console.log('📱 Para la app móvil:');
    console.log('1. Base URL: http://' + LOCAL_IP + ':' + PORT);
    console.log('2. En capacitor.config.json usa esa URL');
    console.log('');
    console.log('🔧 Debug:');
    console.log('   - Revisa que tu IP esté en allowedOrigins');
    console.log('   - Si usas emulador: http://10.0.2.2:' + PORT);
    console.log('='.repeat(50) + '\n');
});

// Función para obtener IP local dinámicamente
function getLocalIP() {
    try {
        const interfaces = require('os').networkInterfaces();
        console.log('🔍 Buscando IPs de red disponibles:');
        
        for (const name of Object.keys(interfaces)) {
            console.log(`   Interfaz: ${name}`);
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`   ✅ IP encontrada: ${iface.address}`);
                    return iface.address;
                }
            }
        }
        
        console.log('⚠️ No se encontró IP local, usando localhost');
        return 'localhost';
    } catch (error) {
        console.error('Error obteniendo IP local:', error);
        return 'localhost';
    }
}