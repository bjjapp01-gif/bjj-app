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

// ========== MIDDLEWARES ESENCIALES ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración CORS para producción
const corsOptions = {
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (apps móviles, Postman, etc.)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:5000',
            'http://localhost:3000',
            'https://bjj-app-backend.onrender.com', // URL de Render (la ajustamos después)
            // Agregar el dominio de tu frontend si está separado
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
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

// ========== MIDDLEWARE DE AUTENTICACIÓN SIMPLIFICADO ==========
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
        
        // Verificar usuario en BD
        const userResult = await pool.query(
            'SELECT id, name, email, belt, role FROM users WHERE id = $1',
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

// ==================== RUTAS PÚBLICAS ====================
// Endpoint /api/register con logging detallado
app.post('/api/register', async (req, res) => {
  try {
    console.log('='.repeat(50));
    console.log('📝 REGISTRO - Datos recibidos completos:');
    console.log('   req.body completo:', JSON.stringify(req.body, null, 2));
    console.log('   Headers:', req.headers['content-type']);
    
    const { name, email, password, belt, role } = req.body;

    console.log('📝 Datos extraídos:');
    console.log('   name:', name);
    console.log('   email:', email);
    console.log('   password:', password ? '********' : 'undefined');
    console.log('   belt:', belt);
    console.log('   role:', role);

    // Validaciones una por una
    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!email) missingFields.push('email');
    if (!password) missingFields.push('password');
    if (!role) missingFields.push('role');

    if (missingFields.length > 0) {
      console.log('❌ Campos faltantes:', missingFields);
      return res.status(400).json({ 
        error: 'Campos requeridos faltantes',
        missing: missingFields
      });
    }

    // Sanitizar inputs
    const sanitizedName = name.trim();
    const sanitizedEmail = email.trim();
    const sanitizedPassword = password;

    console.log('📝 Datos sanitizados:');
    console.log('   name:', sanitizedName);
    console.log('   email:', sanitizedEmail);
    console.log('   password length:', sanitizedPassword.length);

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      console.log('❌ Email no válido:', sanitizedEmail);
      return res.status(400).json({ error: 'Email no válido' });
    }

    // Validar password
    if (sanitizedPassword.length < 6) {
      console.log('❌ Password demasiado corto:', sanitizedPassword.length);
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Validar nombre
    if (sanitizedName.length < 2 || sanitizedName.length > 50) {
      console.log('❌ Nombre inválido, longitud:', sanitizedName.length);
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 50 caracteres' });
    }

    console.log('🔍 Verificando si el email ya existe:', sanitizedEmail);
    
    // Verificar si el usuario ya existe
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1', 
      [sanitizedEmail]
    );
    
    if (userExists.rows.length > 0) {
      console.log('❌ Email ya registrado:', sanitizedEmail);
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    console.log('🔐 Hasheando contraseña...');
    // Hash de contraseña
    const hashedPassword = await bcrypt.hash(sanitizedPassword, 12);
    console.log('✅ Password hasheado correctamente');

    console.log('💾 Insertando usuario en BD...');
    // Insertar usuario
    const result = await pool.query(
      `INSERT INTO users (name, email, password, belt, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, email, belt, role, created_at`,
      [sanitizedName, sanitizedEmail, hashedPassword, belt || 'white', role]
    );

    const user = result.rows[0];
    console.log('✅ Usuario creado en BD:', user.id);

    console.log('🔑 Generando token JWT...');
    // Generar token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    console.log('✅ Token generado');

    console.log('📤 Enviando respuesta exitosa');
    res.status(201).json({ 
      success: true,
      token, 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        belt: user.belt,
        role: user.role
      }
    });

  } catch (err) {
    console.error('❌ ERROR EN REGISTRO:');
    console.error('   Mensaje:', err.message);
    console.error('   Stack:', err.stack);
    console.error('   Código:', err.code);
    console.error('   Detalle:', err.detail);
    
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    res.status(500).json({ 
      error: 'Error creando usuario',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  console.log('='.repeat(50));
}); 

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Intento de login con:', email);

        // Validar email y contraseña
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }

        // Buscar usuario
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Usuario no encontrado' });
        }

        const user = result.rows[0];
        console.log('Hash almacenado:', user.password);
        console.log('Contraseña proporcionada:', password);

        // DIAGNÓSTICO: Verificar si el hash es válido
        const hashParts = user.password.split('$');
        if (hashParts.length < 4) {
            console.log('Hash con formato inválido');
            return res.status(500).json({ error: 'Error en configuración de contraseña' });
        }

        console.log('Versión de bcrypt:', hashParts[1]);
        console.log('Cost factor:', hashParts[2]);

        // ✅ SOLUCIÓN: Comparar DIRECTAMENTE con bcrypt.compare
          console.log('Hash almacenado:', user.password);
          console.log('Contraseña proporcionada:', password);

          // Verificar contraseña CORRECTAMENTE
          const validPassword = await bcrypt.compare(password, user.password);
          console.log('Resultado de bcrypt.compare:', validPassword);

        if (!validPassword) {
            // Intentar con trim por si hay espacios
            const trimmedPassword = password.trim();
            console.log('Contraseña trimmeada:', `"${trimmedPassword}"`);
            
            const validTrimmed = await bcrypt.compare(trimmedPassword, user.password);
            console.log('Resultado con trim:', validTrimmed);
            
            if (!validTrimmed) {
                return res.status(400).json({ error: 'Contraseña incorrecta' });
            }
        }

        // Generar tokens...
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const refreshToken = jwt.sign(
            { id: user.id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '30d' }
        );

        // Guardar refresh token
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
                role: user.role
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
            WHERE 1=1 
        `;
        
        let params = [];
        let paramCount = 0;
        
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

// Crear nueva técnica o pelea
app.post('/api/techniques', authenticateToken, async (req, res) => {
  try {
    const { name, type, belt_level, level, description, video_urls, category } = req.body;
    
    console.log('📥 Creando técnica/pelea con datos:', req.body);
    
    // Validaciones según categoría
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    if (!description || description.trim() === '') {
      return res.status(400).json({ error: 'La descripción es requerida' });
    }
    
    // Para técnicas (no peleas), validar tipo
    if (category !== 'fight' && (!type || type.trim() === '')) {
      return res.status(400).json({ error: 'El tipo de técnica es requerido' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Preparar valores según categoría
      const techniqueType = category === 'fight' ? null : type;
      const techniqueBelt = category === 'fight' ? null : (belt_level || 'white');
      const techniqueLevel = category === 'fight' ? null : (level || 'beginner');
      
      console.log('🗄️ Insertando en BD:', {
        name, 
        type: techniqueType, 
        belt: techniqueBelt, 
        level: techniqueLevel,
        category: category || 'technique'
      });
      
      // Insertar técnica o pelea - VERSIÓN CORREGIDA PARA CATEGORÍA "fight"
let techniqueTypeValue, techniqueBeltValue, techniqueLevelValue;

if (category === 'fight') {
  // Para peleas, usar valores por defecto pero permitir NULL
  techniqueTypeValue = null;
  techniqueBeltValue = null;
  techniqueLevelValue = null;
} else {
  // Para técnicas, usar los valores proporcionados
  techniqueTypeValue = type;
  techniqueBeltValue = belt_level || 'white';
  techniqueLevelValue = level || 'beginner';
}

console.log('🗄️ Insertando en BD:', {
  name: name.trim(),
  type: techniqueTypeValue,
  belt: techniqueBeltValue,
  level: techniqueLevelValue,
  category: category || 'technique'
});

const techniqueResult = await client.query(
  `INSERT INTO techniques (name, type, belt_level, level, description, created_by, approved, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
  [
    name.trim(),
    techniqueTypeValue,
    techniqueBeltValue,
    techniqueLevelValue,
    description.trim(),
    req.user.id,
    req.user.role === 'master',
    category || 'technique'
  ]
);
      
      const technique = techniqueResult.rows[0];
      console.log('✅ Técnica/pelea creada con ID:', technique.id);
      
      // Insertar videos
      if (video_urls && video_urls.length > 0) {
        console.log(`📹 Insertando ${video_urls.length} videos...`);
        
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
      
      // Obtener técnica completa
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
      
      const finalTechnique = finalResult.rows[0];
      console.log('✅ Técnica/pelea completa creada:', finalTechnique.name);
      
      res.status(201).json(finalTechnique);
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Error en transacción:', err);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Error creando técnica/pelea:', err);
    
    // Mejorar mensajes de error
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe una técnica con ese nombre' });
    }
    
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Usuario no válido' });
    }
    
    res.status(500).json({ 
      error: 'Error creando técnica/pelea',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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

// Obtener técnicas pendientes (solo mestre)
app.get('/api/techniques/pending', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const result = await pool.query(
      `SELECT t.*, u.name as creator_name
       FROM techniques t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.approved = false`
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

// Mis Planes
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
            WHERE g.user_id = $1
            GROUP BY g.id, u.name
            ORDER BY g.updated_at DESC`,
            [req.user.id]
        );
        
        console.log(`Encontrados ${result.rows.length} game plans para usuario ${req.user.id}`);
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
      WHERE g.is_public = true
    `;
    
    const params = [req.user.id];
    
    if (position && position !== 'all') {
      query += ` AND g.position = $${params.length + 1}`;
      params.push(position);
    }
    
    query += ` GROUP BY g.id, u.name ORDER BY g.updated_at DESC`;
    
    const result = await pool.query(query, params);
    
    console.log(`✅ Encontrados ${result.rows.length} game plans públicos`);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Error obteniendo game plans públicos:', err);
    res.status(500).json({ 
      error: 'Error del servidor',
      details: err.message 
    });
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

app.post('/api/gameplans', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { name, description, position, is_public, is_suggested, nodes, connections } = req.body;
    
    console.log('🆕 Creando nuevo game plan:', name);
    console.log('📦 Datos recibidos - Nodos:', nodes?.length, 'Conexiones:', connections?.length);

    // Validar campos requeridos
    if (!name || !nodes) {
      return res.status(400).json({ error: 'Nombre y nodos son requeridos' });
    }

    await client.query('BEGIN');

    // Insertar game plan básico
    const insertGP = await client.query(
      `INSERT INTO gameplans (user_id, name, description, position, is_public, is_suggested)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, name, description || '', position || 'guard', is_public || false, is_suggested || false]
    );
    
    const gameplanId = insertGP.rows[0].id;
    console.log('✅ Game Plan creado con ID:', gameplanId);

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
        
        // Guardar mapeo de ID temporal a ID real de base de datos
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
        
        console.log('🔗 Procesando conexión:', {
          from_original: conn.from_node,
          to_original: conn.to_node,
          from_db: fromDbId,
          to_db: toDbId
        });
        
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

// En server.js, modifica la ruta PUT /api/gameplans/:id:
app.put('/api/gameplans/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id } = req.params;
        const { name, description, position, is_public, is_suggested, nodes, connections } = req.body;

        console.log('🔄 Actualizando game plan ID:', id);
        console.log('📦 Datos recibidos - Nodos:', nodes?.length, 'Conexiones:', connections?.length);

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

        // Actualizar información básica del gameplan
        await client.query(
            `UPDATE gameplans 
             SET name = $1, description = $2, position = $3, 
                 is_public = $4, is_suggested = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [name, description, position, is_public, is_suggested, id]
        );

        // Eliminar nodos y conexiones existentes
        await client.query('DELETE FROM gameplan_nodes WHERE gameplan_id = $1', [id]);
        await client.query('DELETE FROM gameplan_connections WHERE gameplan_id = $1', [id]);

        // Insertar nuevos nodos y guardar el mapeo de IDs
        const nodeIdMap = {}; // Mapeo: frontend ID -> database ID
        if (nodes && nodes.length > 0) {
            for (const node of nodes) {
                const result = await client.query(
                    `INSERT INTO gameplan_nodes (gameplan_id, technique_id, name, type, x, y)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [id, node.technique_id, node.name, node.type, node.x, node.y]
                );
                
                // Guardar el mapeo de IDs: el ID original del nodo -> nuevo ID de base de datos
                nodeIdMap[node.id] = result.rows[0].id;
            }
        }

        console.log('🗺️ Mapeo de IDs de nodos:', nodeIdMap);

        // Insertar nuevas conexiones usando el mapeo de IDs
        if (connections && connections.length > 0) {
            for (const conn of connections) {
                const fromDbId = nodeIdMap[conn.from_node];
                const toDbId = nodeIdMap[conn.to_node];
                
                console.log('🔗 Procesando conexión:', {
                    from_original: conn.from_node,
                    to_original: conn.to_node,
                    from_db: fromDbId,
                    to_db: toDbId
                });
                
                if (fromDbId && toDbId) {
                    await client.query(
                        `INSERT INTO gameplan_connections (gameplan_id, from_node, to_node)
                         VALUES ($1, $2, $3)`,
                        [id, fromDbId, toDbId]
                    );
                    console.log('✅ Conexión creada exitosamente');
                } else {
                    console.warn('⚠️ No se pudo mapear conexión:', conn);
                }
            }
        }

        await client.query('COMMIT');

        // Devolver el gameplan actualizado
        const updatedResult = await pool.query(`
            SELECT g.*, u.name AS creator_name,
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
            [id]
        );

        console.log('✅ Game Plan actualizado con éxito');
        console.log('📊 Nodos finales:', updatedResult.rows[0].nodes.length);
        console.log('📊 Conexiones finales:', updatedResult.rows[0].connections.length);

        res.json(updatedResult.rows[0]);

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

// Obtener objetivos de un alumno
app.get('/api/students/:id/objectives', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const studentId = req.params.id;

        const result = await pool.query(`
            SELECT id, title, description, deadline, completed, completed_at, created_at
            FROM user_objectives 
            WHERE user_id = $1 
            ORDER BY 
                completed ASC,
                deadline ASC NULLS LAST,
                created_at DESC
        `, [studentId]);

        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo objetivos del alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ESTADÍSTICAS DEL CLUB ====================

// Endpoint para obtener estadísticas del club
app.get('/api/club/statistics', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const client = await pool.connect();
        
        try {
            // 1. Estado de alumnos (activos/inactivos/irregulares)
            const studentsStatus = await client.query(`
                SELECT 
                    COUNT(CASE WHEN last_session_date IS NULL OR NOW() - last_session_date > INTERVAL '30 days' THEN 1 END) as inactive,
                    COUNT(CASE WHEN last_session_date IS NOT NULL AND NOW() - last_session_date <= INTERVAL '7 days' THEN 1 END) as active,
                    COUNT(CASE WHEN last_session_date IS NOT NULL AND NOW() - last_session_date > INTERVAL '7 days' AND NOW() - last_session_date <= INTERVAL '30 days' THEN 1 END) as irregular
                FROM users u
                LEFT JOIN student_activity sa ON u.id = sa.user_id
                WHERE u.role = 'student'
            `);

            // 2. Alumnos por cinturón
            const studentsByBelt = await client.query(`
                SELECT belt, COUNT(*) as count
                FROM users 
                WHERE role = 'student' 
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
            `);

            // 3. Sesiones promedio por semana
            const avgSessionsPerWeek = await client.query(`
                SELECT 
                    COALESCE(AVG(session_count), 0) as avg_sessions,
                    COUNT(DISTINCT u.id) as total_students
                FROM users u
                LEFT JOIN student_activity sa ON u.id = sa.user_id
                WHERE u.role = 'student'
            `);

            // 4. Top alumnos por sesiones (últimos 30 días)
            const topStudents = await client.query(`
                SELECT 
                    u.name,
                    u.belt,
                    COALESCE(sa.session_count, 0) as session_count,
                    sa.last_session_date
                FROM users u
                LEFT JOIN student_activity sa ON u.id = sa.user_id
                WHERE u.role = 'student'
                ORDER BY session_count DESC, last_session_date DESC
                LIMIT 5
            `);

            // 5. Sensaciones promedio en sesiones (últimas 2 semanas)
            const sessionFeelings = await client.query(`
                SELECT 
                    DATE_TRUNC('day', date) as day,
                    AVG(rating) as avg_rating,
                    COUNT(*) as session_count
                FROM training_sessions 
                WHERE date >= NOW() - INTERVAL '14 days'
                GROUP BY DATE_TRUNC('day', date)
                ORDER BY day
            `);

            // 6. Alertas automáticas
            const alerts = await generateAutomaticAlerts(client);

            // Formatear respuesta
            const beltData = {};
            studentsByBelt.rows.forEach(row => {
                beltData[row.belt] = parseInt(row.count);
            });

            const feelingsData = {
                labels: sessionFeelings.rows.map(row => 
                    new Date(row.day).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                ),
                values: sessionFeelings.rows.map(row => parseFloat(row.avg_rating) || 0)
            };

            res.json({
                studentsStatus: studentsStatus.rows[0],
                studentsByBelt: beltData,
                avgSessionsPerWeek: parseFloat(avgSessionsPerWeek.rows[0].avg_sessions) || 0,
                topStudents: topStudents.rows,
                sessionFeelings: feelingsData,
                alerts: alerts
            });

        } finally {
            client.release();
        }

    } catch (err) {
        console.error('Error obteniendo estadísticas del club:', err);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

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

// Ruta para buscar usuarios por nombre o email
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 3) {
      return res.status(400).json({ error: 'Término de búsqueda demasiado corto' });
    }
    
    const result = await pool.query(
      `SELECT id, name, email, belt, role 
       FROM users 
       WHERE (name ILIKE $1 OR email ILIKE $1) AND id != $2
       LIMIT 10`,
      [`%${q}%`, req.user.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error buscando usuarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta para compartir con usuario específico
app.post('/api/gameplans/:id/share-with-user', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    // Verificar que el game plan existe y pertenece al usuario
    const gameplanCheck = await pool.query(
      'SELECT * FROM gameplans WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (gameplanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Game Plan no encontrado' });
    }
    
    // Verificar que el usuario destino existe
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
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
    
    // Crear notificación - CORRECCIÓN: usar id en lugar de gamePlanId
    const gameplan = gameplanCheck.rows[0];
    const fromUser = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    
    await pool.query(
    `INSERT INTO notifications (user_id, title, message, type, related_id) 
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, 'Game Plan Compartido', 
     `${fromUser.rows[0].name} te ha compartido el Game Plan: ${gameplan.name}`, 
     'share', id]  // ← CORRECCIÓN: usar id
    );
    
    res.json({ message: 'Game Plan compartido correctamente' });
  } catch (err) {
    console.error('Error compartiendo game plan:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta para obtener notificaciones
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.* 
       FROM notifications n 
       WHERE n.user_id = $1 
       ORDER BY n.created_at DESC 
       LIMIT 20`,
      [req.user.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo notificaciones:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta para marcar notificación como leída
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    res.json({ message: 'Notificación marcada como leída' });
  } catch (err) {
    console.error('Error actualizando notificación:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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

// EN SERVER.JS - VERIFICA QUE ESTÉ ESTA RUTA (debe estar ANTES del app.listen)
app.get('/api/gameplans/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
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
      WHERE g.id = $1
      GROUP BY g.id, u.name`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Game Plan no encontrado' });
    }
    
    const gameplan = result.rows[0];
    console.log(`✅ Game Plan ${id} cargado con ${gameplan.nodes.length} nodos y ${gameplan.connections.length} conexiones`);
    
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

// ==================== RUTAS PARA EVENTOS Y HORARIOS ====================

// Obtener eventos - VERSIÓN CON LOGGING DETALLADO
app.get('/api/events', authenticateToken, async (req, res) => {
    try {
        console.log(`📅 [EVENTS] Obteniendo eventos para usuario: ${req.user.id} (${req.user.name})`);
        console.log(`   Rol del usuario: ${req.user.role}`);
        
        const result = await pool.query(
            `SELECT e.*, 
                    COALESCE(e.torneo_data, '{}'::jsonb) as torneo_data,
                    u.name as created_by_name
             FROM events e
             LEFT JOIN users u ON e.created_by = u.id
             ORDER BY e.date ASC`
        );
        
        console.log(`✅ [EVENTS] Consulta BD exitosa. Encontrados: ${result.rows.length} eventos`);
        
        // Asegurar que torneo_data siempre sea un objeto válido
        const events = result.rows.map(event => ({
            ...event,
            torneo_data: event.torneo_data || {}
        }));
        
        console.log(`📤 [EVENTS] Enviando respuesta con ${events.length} eventos`);
        
        res.json(events);
        
    } catch (err) {
        console.error('❌ [EVENTS] Error obteniendo eventos:', err);
        console.error('   Error stack:', err.stack);
        res.status(500).json({ 
            error: 'Error del servidor',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Crear nuevo evento
app.post('/api/events', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden crear eventos' });
    }

    const { title, date, time, type, description, torneo_data } = req.body;
    
    if (!title || !date || !type) {
      return res.status(400).json({ error: 'Título, fecha y tipo son requeridos' });
    }

    // Combinar fecha y hora
    const fullDate = time ? `${date}T${time}:00` : date;

    const result = await pool.query(
      `INSERT INTO events (title, date, type, description, torneo_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, fullDate, type, description, torneo_data || null, req.user.id]
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

// Obtener horarios de entrenamiento
app.get('/api/training-schedule', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM training_schedule ORDER BY day_order'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo horarios:', err);
    res.status(500).json({ error: 'Error del servidor' });
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

            // Eliminar horarios existentes
            await client.query('DELETE FROM training_schedule');

            // Insertar nuevos horarios
            for (const item of schedule) {
                if (item.day && item.time && item.class && item.level) {
                    await client.query(
                        `INSERT INTO training_schedule (day, time, class, level, day_order)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [item.day, item.time, item.class, item.level, getDayOrder(item.day)]
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
        res.status(500).json({ error: 'Error actualizando horarios' });
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

// Obtener todos los alumnos - VERSIÓN CORREGIDA PARA ESTADO
app.get('/api/students', authenticateToken, async (req, res) => {
    try {
        console.log('📥 Solicitud para obtener alumnos recibida');
        
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden acceder a esta función' });
        }

        const { search, belt, status } = req.query;
        
        // QUERY CORREGIDA - usando fecha actual correctamente
        let query = `
            SELECT 
                u.id, u.name, u.email, u.belt, u.role, u.created_at,
                up.nickname, up.academy, up.profile_picture,
                sa.session_count, sa.last_session_date, sa.status,
                sa.notes as activity_notes,
                CASE 
                    WHEN sa.last_session_date IS NULL THEN 'inactive'
                    WHEN sa.last_session_date < CURRENT_DATE - INTERVAL '30 days' THEN 'inactive'
                    WHEN sa.last_session_date < CURRENT_DATE - INTERVAL '7 days' THEN 'irregular'
                    ELSE 'active'
                END as calculated_status
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN student_activity sa ON u.id = sa.user_id
            WHERE u.role = 'student'
        `;
        
        let params = [];
        let paramCount = 0;

        // Filtros
        if (search) {
            paramCount++;
            query += ` AND (u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (belt && belt !== 'all') {
            paramCount++;
            query += ` AND u.belt = $${paramCount}`;
            params.push(belt);
        }

        // Filtro por estado (usando calculated_status)
        if (status && status !== 'all') {
            if (status === 'active') {
                query += ` AND (
                    sa.last_session_date >= CURRENT_DATE - INTERVAL '7 days'
                    OR (sa.status = 'active' AND sa.last_session_date IS NOT NULL)
                )`;
            } else if (status === 'irregular') {
                query += ` AND (
                    sa.last_session_date < CURRENT_DATE - INTERVAL '7 days' 
                    AND sa.last_session_date >= CURRENT_DATE - INTERVAL '30 days'
                )`;
            } else if (status === 'inactive' || status === 'inactivo') {
                query += ` AND (
                    sa.last_session_date IS NULL 
                    OR sa.last_session_date < CURRENT_DATE - INTERVAL '30 days'
                    OR sa.status = 'inactive'
                )`;
            }
        }

        query += ' ORDER BY u.name';

        console.log('🔍 Ejecutando query de alumnos...');
        const result = await pool.query(query, params);
        
        // DEBUG: Mostrar información de cada alumno
        result.rows.forEach(student => {
            console.log(`👤 ${student.name}:`, {
                last_session: student.last_session_date,
                calculated_status: student.calculated_status,
                session_count: student.session_count
            });
        });
        
        console.log(`✅ ${result.rows.length} alumnos encontrados`);
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Error obteniendo alumnos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
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

// Actualizar alumno
app.put('/api/students/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden editar alumnos' });
        }

        const studentId = req.params.id;
        const { name, email, belt, status, phone, notes } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Actualizar usuario
            await client.query(
                'UPDATE users SET name = $1, email = $2, belt = $3, phone = $4 WHERE id = $5',
                [name, email, belt, phone, studentId]
            );

            // Actualizar actividad del estudiante
            await client.query(
                'UPDATE student_activity SET status = $1, notes = $2 WHERE user_id = $3',
                [status, notes, studentId]
            );

            await client.query('COMMIT');

            res.json({ message: 'Alumno actualizado exitosamente' });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error actualizando alumno:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
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

// Obtener estadísticas del club
app.get('/api/club/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'master') {
            return res.status(403).json({ error: 'Solo los mestres pueden ver estadísticas del club' });
        }

        const client = await pool.connect();
        
        try {
            // Estadísticas de alumnos por cinturón
            const beltStats = await client.query(`
                SELECT belt, COUNT(*) as count 
                FROM users 
                WHERE role = 'student' 
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
            `);

            // Estadísticas de actividad
            const activityStats = await client.query(`
                SELECT 
                    COUNT(*) as total_students,
                    COUNT(CASE WHEN last_session_date IS NOT NULL AND NOW() - last_session_date <= INTERVAL '7 days' THEN 1 END) as active_students,
                    COUNT(CASE WHEN last_session_date IS NULL OR NOW() - last_session_date > INTERVAL '30 days' THEN 1 END) as inactive_students,
                    AVG(session_count) as avg_sessions
                FROM student_activity sa
                JOIN users u ON sa.user_id = u.id
                WHERE u.role = 'student'
            `);

            // Alumnos más activos
            const topStudents = await client.query(`
                SELECT 
                    u.name, u.belt, sa.session_count, sa.last_session_date
                FROM student_activity sa
                JOIN users u ON sa.user_id = u.id
                WHERE u.role = 'student'
                ORDER BY sa.session_count DESC
                LIMIT 5
            `);

            // Sesiones por mes (últimos 6 meses)
            const monthlySessions = await client.query(`
                SELECT 
                    DATE_TRUNC('month', date) as month,
                    COUNT(*) as session_count
                FROM training_sessions
                WHERE date >= CURRENT_DATE - INTERVAL '6 months'
                GROUP BY DATE_TRUNC('month', date)
                ORDER BY month
            `);

            // Sensaciones promedio en sesiones
            const sessionFeelings = await client.query(`
                SELECT 
                    DATE_TRUNC('week', date) as week,
                    AVG(rating) as avg_rating,
                    COUNT(*) as session_count
                FROM training_sessions 
                WHERE date >= NOW() - INTERVAL '4 weeks'
                GROUP BY DATE_TRUNC('week', date)
                ORDER BY week
            `);

            // Alertas automáticas
            const alerts = await generateAutomaticAlerts(client);

            res.json({
                belt_stats: beltStats.rows,
                activity_stats: activityStats.rows[0],
                top_students: topStudents.rows,
                monthly_sessions: monthlySessions.rows,
                session_feelings: sessionFeelings.rows,
                alerts: alerts,
                total_students: beltStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
            });

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error obteniendo estadísticas del club:', error);
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

// Añadir nota privada a un alumno
app.post('/api/students/:id/notes', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Solo los mestres pueden añadir notas' });
    }

    const { category, content, is_private } = req.body;

    const result = await pool.query(
      `INSERT INTO student_notes (student_id, master_id, category, content, is_private)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, req.user.id, category, content, is_private !== false]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error añadiendo nota:', err);
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
app.get('/user/objectives', authenticateToken, async (req, res) => {
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