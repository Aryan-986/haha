const dns = require('dns');
// Use reliable public DNS to prevent queryTxt ETIMEOUT on MongoDB Atlas SRV records
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (dnsErr) {
  console.warn('Could not set custom DNS servers:', dnsErr.message);
}

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const { clerkMiddleware } = require('@clerk/express');
const { initSocket } = require('./socket');
require('dotenv').config();

// ============================================================
// Fail-fast on missing critical configuration in production
// ============================================================
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  const required = ['MONGO_URI', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

const app = express();
const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = initSocket(httpServer);

// ============================================================
// Security Headers (helmet)
// ============================================================
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding for portal iframes
  contentSecurityPolicy: false       // Managed per-portal in frontend
}));

// ============================================================
// CORS — environment-based allowlist
// ============================================================
const ALLOWED_ORIGINS_ENV = process.env.CORS_ALLOWED_ORIGINS || '';
const ALWAYS_ALLOWED = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176'
];

const allowedOrigins = isProd
  ? ALLOWED_ORIGINS_ENV.split(',').map(o => o.trim()).filter(Boolean)
  : [...ALWAYS_ALLOWED, ...ALLOWED_ORIGINS_ENV.split(',').map(o => o.trim()).filter(Boolean)];

if (isProd && allowedOrigins.length === 0) {
  console.warn('[CORS] WARNING: No CORS_ALLOWED_ORIGINS set in production. All cross-origin requests will be blocked.');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin) and configured origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-ID'],
  credentials: true
}));

// ============================================================
// Body parsing with reasonable size limits
// ============================================================
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ============================================================
// Clerk Authentication Context
// ============================================================
if (process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) {
  app.use(clerkMiddleware());
} else {
  if (isProd) {
    console.error('FATAL: Clerk keys missing in production environment.');
    process.exit(1);
  }
  console.warn('⚠️  Clerk keys missing. Auth middleware bypassed (development mode only).');
}

// ============================================================
// Pass Socket.IO instance to request context
// ============================================================
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ============================================================
// Request logging (non-production: minimal; production: structured)
// ============================================================
app.use((req, res, next) => {
  if (isProd) {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (res.statusCode >= 400) {
        console.warn(JSON.stringify({
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: duration,
          ua: req.headers['user-agent']?.slice(0, 80)
        }));
      }
    });
  }
  next();
});

// ============================================================
// Health & Readiness endpoints
// ============================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/ready', async (_req, res) => {
  const dbState = mongoose.connection.readyState;
  // 1 = connected
  if (dbState === 1) {
    res.json({ status: 'ready', db: 'connected' });
  } else {
    res.status(503).json({ status: 'not_ready', db: 'disconnected' });
  }
});

// ============================================================
// Database Connection
// ============================================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully');
    // Auto-seed only in non-production environments
    if (!isProd) {
      const Service = require('./models/Service');
      try {
        const existingService = await Service.findOne();
        if (!existingService) {
          await Service.create({
            office: 'District Administration Office (DAO), Kathmandu',
            name: 'Citizenship & National ID Application',
            currentQueueCount: 15,
            currentlyServingNumber: 100,
            activeCounters: 3,
            estimatedWaitMin: 45,
            crowdLevel: 'MODERATE CROWD'
          });
          console.log('Default DAO Kathmandu Service auto-seeded (dev only).');
        }
      } catch (seedErr) {
        console.warn('Auto-seed skipped:', seedErr.message);
      }
    }
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err.message);
    if (isProd) process.exit(1);
  });

// ============================================================
// Routes — Canonical /api/v1 only
// Legacy aliases kept temporarily for backward compatibility
// but ONLY if they apply identical middleware
// ============================================================
const queueRoutes = require('./routes/queueRoutes');
const workerRoutes = require('./routes/workerRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const departmentRoutes = require('./routes/departmentRoutes');
const counterRoutes = require('./routes/counterRoutes');
const adminRoutes = require('./routes/adminRoutes');
const accessRequestRoutes = require('./routes/accessRequestRoutes');

// Primary canonical versioned API
app.use('/api/v1', queueRoutes);
app.use('/api/v1/worker', workerRoutes);
app.use('/api/v1/orgs', organizationRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/counters', counterRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/access-requests', accessRequestRoutes);

// Legacy aliases (deprecated — clients should migrate to /api/v1)
// These are intentionally kept so existing frontend code doesn't break
// but will be removed in the next major version
app.use('/api', queueRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/orgs', organizationRoutes);
app.use('/orgs', organizationRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/counters', counterRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/access-requests', accessRequestRoutes);

// ============================================================
// Global Error Handler
// Never leaks stack traces or internal details to clients
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (!isProd) {
    console.error('[Error]', err);
  } else {
    console.error(JSON.stringify({ error: message, url: req.originalUrl, status }));
  }

  // Never send stack traces or raw error details to clients
  res.status(status).json({
    error: status < 500
      ? message
      : 'An unexpected error occurred. Please try again later.'
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// ============================================================
// Start Server
// ============================================================
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`[QueueLess] Server running on port ${PORT} (HTTP + WebSocket)`);
    console.log(`[QueueLess] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = { app, httpServer, io };