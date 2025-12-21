import { verifyAuthToken } from '../config/supabase.js';

/**
 * Authentication middleware
 * Verifies the JWT token from the Authorization header
 */
export async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required. Please provide a valid token.'
            });
        }

        const user = await verifyAuthToken(authHeader);

        if (!user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired token. Please log in again.'
            });
        }

        // Attach user to request for use in controllers
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            error: 'Authentication Error',
            message: 'An error occurred during authentication.'
        });
    }
}

/**
 * Optional auth middleware - doesn't require auth but attaches user if present
 */
export async function optionalAuthMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader) {
            const user = await verifyAuthToken(authHeader);
            if (user) {
                req.user = user;
            }
        }

        next();
    } catch (error) {
        // Don't fail on optional auth errors
        console.error('Optional auth error:', error);
        next();
    }
}
