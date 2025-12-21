import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { generatePRD } from './controllers/prdController.js';
import { generateArchitecture } from './controllers/architectureController.js';
import { generateDatabase } from './controllers/databaseController.js';
import { generateUserflow } from './controllers/userflowController.js';
import { generateBundle } from './controllers/bundleController.js';
import { createOrder, verifyPayment, handleWebhook, changePlan } from './controllers/paymentController.js';
import { requestPasswordReset, getPasswordResetStatus } from './controllers/authController.js';
import { authMiddleware } from './middleware/auth.js';
import { validateAndSanitize } from './middleware/sanitize.js';
import { generateRateLimiter, defaultRateLimiter } from './middleware/rateLimit.js';
import { validatePlanAndCredits, requireCredits, requireBundleAccess, enforceDailyLimit, incrementDailyCount, CREDIT_COSTS, DAILY_LIMITS } from './middleware/planValidation.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// CORS Configuration - Restrict to specific origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  // Add your production domain here:
  // 'https://yourdomain.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    // In production, block requests with no origin (prevents CSRF via iframes/curl)
    // In development, allow for testing convenience
    if (!origin) {
      if (isProduction) {
        return callback(new Error('Not allowed by CORS'));
      }
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// ========== SECURITY MIDDLEWARE ==========

// Helmet - Sets various HTTP headers for security
// Protects against XSS, clickjacking, content-type sniffing, etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", ...allowedOrigins],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable if you need to embed external resources
}));

// HTTPS enforcement in production
if (isProduction) {
  app.use((req, res, next) => {
    // Check if request was forwarded from HTTPS (common with proxies/load balancers)
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// CORS
app.use(cors(corsOptions));

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Apply default rate limiter to all routes
app.use(defaultRateLimiter);

// ========== PROTECTED API ROUTES ==========
// Security stack (in order):
// 1. generateRateLimiter - Stricter rate limiting for AI endpoints
// 2. authMiddleware - Verify JWT token
// 3. validatePlanAndCredits - Fetch REAL plan from database (prevents spoofing)
// 4. enforceDailyLimit - Prevent AI cost exploitation (daily cap per plan)
// 5. requireCredits - Check if user has enough credits
// 6. validateAndSanitize - Input validation and sanitization
// 7. Controller - Handle the request (with server-side credit deduction)

app.post('/api/generate-prd',
  generateRateLimiter,
  authMiddleware,
  validatePlanAndCredits,
  enforceDailyLimit,
  requireCredits(CREDIT_COSTS.SINGLE_REPORT),
  validateAndSanitize,
  generatePRD
);

app.post('/api/generate-architecture',
  generateRateLimiter,
  authMiddleware,
  validatePlanAndCredits,
  enforceDailyLimit,
  requireCredits(CREDIT_COSTS.SINGLE_REPORT),
  validateAndSanitize,
  generateArchitecture
);

app.post('/api/generate-database',
  generateRateLimiter,
  authMiddleware,
  validatePlanAndCredits,
  enforceDailyLimit,
  requireCredits(CREDIT_COSTS.SINGLE_REPORT),
  validateAndSanitize,
  generateDatabase
);

app.post('/api/generate-userflow',
  generateRateLimiter,
  authMiddleware,
  validatePlanAndCredits,
  enforceDailyLimit,
  requireCredits(CREDIT_COSTS.SINGLE_REPORT),
  validateAndSanitize,
  generateUserflow
);

// Developer Bundle - Server-side plan restriction (not client-side!)
app.post('/api/generate-bundle',
  generateRateLimiter,
  authMiddleware,
  validatePlanAndCredits,
  enforceDailyLimit,
  requireBundleAccess,  // Checks plan AND credits server-side
  validateAndSanitize,
  generateBundle
);

// Health check (public endpoint)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ========== RAZORPAY PAYMENT ROUTES ==========

// Create Razorpay order - requires authentication
app.post('/api/create-order',
  defaultRateLimiter,
  authMiddleware,
  createOrder
);

// Verify payment after checkout - requires authentication
app.post('/api/verify-payment',
  defaultRateLimiter,
  authMiddleware,
  verifyPayment
);

// Razorpay webhook - NO auth (Razorpay calls this)
// FIX: Use raw body for signature verification, then parse JSON
app.post('/api/razorpay-webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Preserve raw body as string for signature verification
    req.rawBody = req.body.toString('utf8');
    // Parse JSON for handler
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next();
  },
  handleWebhook
);

// Change plan (for downgrades) - requires authentication
app.post('/api/change-plan',
  defaultRateLimiter,
  authMiddleware,
  changePlan
);

// ========== PASSWORD RESET ROUTES ==========

// Request password reset - public endpoint with rate limiting
app.post('/api/request-password-reset',
  defaultRateLimiter,
  requestPasswordReset
);

// Get password reset status - public endpoint
app.post('/api/password-reset-status',
  defaultRateLimiter,
  getPasswordResetStatus
);

// Error handling middleware
app.use((err, req, res, next) => {
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Origin not allowed'
    });
  }

  // Handle payload too large errors (for DoS monitoring)
  if (err.type === 'entity.too.large') {
    console.warn(`⚠️ Payload too large from IP: ${req.ip}`);
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body exceeds the 1MB limit'
    });
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body'
    });
  }

  // Log error without exposing details (redact sensitive info)
  console.error('Server error:', err.message);

  // Generic error response - never expose internal details
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log('🔒 Security features enabled:');
  console.log('   - Helmet security headers');
  console.log('   - CORS restricted to allowed origins');
  console.log('   - JWT authentication required');
  console.log('   - Rate limiting active');
  console.log('   - Input sanitization enabled');
  console.log('   - Server-side plan verification (anti-spoofing)');
  console.log('   - Server-side credit deduction (anti-cheat)');
  console.log('   - Plan expiration enforcement');
  console.log('   - Daily generation limits (AI abuse prevention)');
  if (isProduction) {
    console.log('   - HTTPS enforcement active');
    console.log('   - Null origin CORS blocked');
  }
});
