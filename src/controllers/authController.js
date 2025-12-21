import { supabase } from '../config/supabase.js';

// Constants for rate limiting
const RATE_LIMIT_HOURS = 0; // Can only request reset once per 48 hours
const MAX_LIFETIME_RESETS = 3; // Maximum 3 password resets per account lifetime

/**
 * Request Password Reset
 * POST /api/request-password-reset
 * 
 * Rate limiting: 1 request per 48 hours
 * Lifetime limit: 3 total resets per account
 */
export async function requestPasswordReset(req, res) {
    try {
        const { email } = req.body;

        // Validate email format
        if (!email || typeof email !== 'string') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Email is required'
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Please enter a valid email address'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user exists (we need user_id for tracking)
        // We use admin API to look up user by email
        const { data: userData, error: userError } = await supabase.auth.admin.listUsers();

        if (userError) {
            console.error('Error fetching users:', userError);
            // Don't reveal the error to prevent enumeration
            return res.status(200).json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // Find user by email
        const user = userData.users.find(u => u.email?.toLowerCase() === normalizedEmail);

        // If user doesn't exist, return success anyway (prevent email enumeration)
        if (!user) {
            return res.status(200).json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // Check password reset tracking for this user
        const { data: tracking, error: trackingError } = await supabase
            .from('password_reset_tracking')
            .select('*')
            .eq('user_id', user.id)
            .single();

        // If no tracking record exists, create one
        if (trackingError && trackingError.code === 'PGRST116') {
            // No record found - this is the user's first reset request
            // Continue to send reset email
        } else if (trackingError) {
            console.error('Error fetching tracking:', trackingError);
            return res.status(500).json({
                error: 'Server Error',
                message: 'An error occurred. Please try again later.'
            });
        } else if (tracking) {
            // Check lifetime limit
            if (tracking.total_resets >= MAX_LIFETIME_RESETS) {
                return res.status(429).json({
                    error: 'Limit Exceeded',
                    message: `You have reached the maximum limit of ${MAX_LIFETIME_RESETS} password resets. Please contact support at support@xiron.com for assistance.`,
                    limitType: 'lifetime',
                    totalResets: tracking.total_resets,
                    maxResets: MAX_LIFETIME_RESETS
                });
            }

            // Check 48-hour rate limit
            if (tracking.last_reset_requested_at) {
                const lastRequest = new Date(tracking.last_reset_requested_at);
                const now = new Date();
                const hoursSinceLastRequest = (now - lastRequest) / (1000 * 60 * 60);

                if (hoursSinceLastRequest < RATE_LIMIT_HOURS) {
                    const hoursRemaining = Math.ceil(RATE_LIMIT_HOURS - hoursSinceLastRequest);
                    return res.status(429).json({
                        error: 'Rate Limited',
                        message: `You can only request a password reset once every ${RATE_LIMIT_HOURS} hours. Please try again in ${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}.`,
                        limitType: 'rate',
                        hoursRemaining: hoursRemaining,
                        resetsRemaining: MAX_LIFETIME_RESETS - tracking.total_resets
                    });
                }
            }
        }

        // Get the frontend URL for redirect
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${frontendUrl}/reset-password`;

        // Send password reset email via Supabase
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
            redirectTo: redirectUrl
        });

        if (resetError) {
            console.error('Error sending reset email:', resetError);
            return res.status(500).json({
                error: 'Server Error',
                message: 'Failed to send reset email. Please try again later.'
            });
        }

        // Update tracking table
        const newTotalResets = tracking ? tracking.total_resets + 1 : 1;

        const { error: upsertError } = await supabase
            .from('password_reset_tracking')
            .upsert({
                user_id: user.id,
                last_reset_requested_at: new Date().toISOString(),
                total_resets: newTotalResets
            }, {
                onConflict: 'user_id'
            });

        if (upsertError) {
            console.error('Error updating tracking:', upsertError);
            // Don't fail the request - email was already sent
        }

        // Return success with remaining resets info
        return res.status(200).json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.',
            resetsRemaining: MAX_LIFETIME_RESETS - newTotalResets
        });

    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({
            error: 'Server Error',
            message: 'An unexpected error occurred. Please try again later.'
        });
    }
}

/**
 * Get Password Reset Status
 * POST /api/password-reset-status
 * 
 * Returns the current reset status for a user (for frontend display)
 */
export async function getPasswordResetStatus(req, res) {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Email is required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Find user by email
        const { data: userData, error: userError } = await supabase.auth.admin.listUsers();

        if (userError) {
            // Don't reveal if user exists
            return res.status(200).json({
                canReset: true,
                resetsRemaining: MAX_LIFETIME_RESETS
            });
        }

        const user = userData.users.find(u => u.email?.toLowerCase() === normalizedEmail);

        if (!user) {
            // Don't reveal if user exists
            return res.status(200).json({
                canReset: true,
                resetsRemaining: MAX_LIFETIME_RESETS
            });
        }

        // Get tracking data
        const { data: tracking, error: trackingError } = await supabase
            .from('password_reset_tracking')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (trackingError && trackingError.code === 'PGRST116') {
            // No tracking record - user hasn't reset before
            return res.status(200).json({
                canReset: true,
                resetsRemaining: MAX_LIFETIME_RESETS,
                totalResets: 0
            });
        }

        if (trackingError) {
            return res.status(200).json({
                canReset: true,
                resetsRemaining: MAX_LIFETIME_RESETS
            });
        }

        // Calculate status
        const resetsRemaining = MAX_LIFETIME_RESETS - tracking.total_resets;
        let canReset = resetsRemaining > 0;
        let hoursRemaining = 0;

        if (tracking.last_reset_requested_at && canReset) {
            const lastRequest = new Date(tracking.last_reset_requested_at);
            const now = new Date();
            const hoursSinceLastRequest = (now - lastRequest) / (1000 * 60 * 60);

            if (hoursSinceLastRequest < RATE_LIMIT_HOURS) {
                canReset = false;
                hoursRemaining = Math.ceil(RATE_LIMIT_HOURS - hoursSinceLastRequest);
            }
        }

        return res.status(200).json({
            canReset,
            resetsRemaining,
            totalResets: tracking.total_resets,
            maxResets: MAX_LIFETIME_RESETS,
            hoursRemaining: hoursRemaining > 0 ? hoursRemaining : undefined,
            rateLimitHours: RATE_LIMIT_HOURS
        });

    } catch (error) {
        console.error('Password reset status error:', error);
        return res.status(200).json({
            canReset: true,
            resetsRemaining: MAX_LIFETIME_RESETS
        });
    }
}
