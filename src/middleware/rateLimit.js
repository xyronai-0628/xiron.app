/**
 * Simple in-memory rate limiter
 * For production, use redis-based rate limiting
 */

const requestCounts = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requestCounts.entries()) {
        if (now - data.windowStart > 60000) {
            requestCounts.delete(key);
        }
    }
}, 300000);

/**
 * Rate limiter configuration
 */
const RATE_LIMITS = {
    // General API rate limit
    default: {
        windowMs: 60000,  // 1 minute
        maxRequests: 30
    },
    // AI generation endpoints (more expensive)
    generate: {
        windowMs: 60000,  // 1 minute
        maxRequests: 10
    }
};

/**
 * Get client identifier (IP or user ID)
 */
function getClientId(req) {
    // Prefer user ID if authenticated
    if (req.user?.id) {
        return `user:${req.user.id}`;
    }

    // Fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
    return `ip:${ip}`;
}

/**
 * Rate limiting middleware factory
 */
export function rateLimiter(limitType = 'default') {
    const config = RATE_LIMITS[limitType] || RATE_LIMITS.default;

    return (req, res, next) => {
        const clientId = getClientId(req);
        const key = `${clientId}:${limitType}`;
        const now = Date.now();

        let data = requestCounts.get(key);

        if (!data || now - data.windowStart > config.windowMs) {
            // Start new window
            data = {
                windowStart: now,
                count: 0
            };
        }

        data.count++;
        requestCounts.set(key, data);

        // Set rate limit headers
        const remaining = Math.max(0, config.maxRequests - data.count);
        const resetTime = Math.ceil((data.windowStart + config.windowMs - now) / 1000);

        res.setHeader('X-RateLimit-Limit', config.maxRequests);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', resetTime);

        if (data.count > config.maxRequests) {
            return res.status(429).json({
                error: 'Too Many Requests',
                message: `Rate limit exceeded. Please try again in ${resetTime} seconds.`,
                retryAfter: resetTime
            });
        }

        next();
    };
}

// Pre-configured rate limiters
export const defaultRateLimiter = rateLimiter('default');
export const generateRateLimiter = rateLimiter('generate');
