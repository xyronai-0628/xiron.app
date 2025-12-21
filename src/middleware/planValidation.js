import { supabase } from '../config/supabase.js';

/**
 * Credit costs for different operations
 */
export const CREDIT_COSTS = {
    SINGLE_REPORT: 40,
    BUNDLE: 160,  // 4 reports
    UPDATE: 10
};

/**
 * Daily generation limits per plan (prevents AI cost exploitation)
 * Even with valid credits, users are limited to prevent abuse
 */
export const DAILY_LIMITS = {
    free: 5,      // 5 generations per day
    starter: 20,  // 20 generations per day
    pro: 50       // 50 generations per day
};

/**
 * PRODUCTION-SAFE: Database-backed daily generation tracking
 * Uses Supabase RPC for atomic increment with race-condition protection
 * 
 * Why this is safe:
 * - Survives server restarts
 * - Works across multiple server instances
 * - Atomic increment prevents race conditions
 * - Works on serverless platforms (Render, Railway, Vercel)
 */

/**
 * Get today's generation count from database
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Current daily count
 */
async function getDailyCountDB(userId) {
    const { data, error } = await supabase.rpc('get_daily_generation_count', {
        p_user_id: userId
    });

    if (error) {
        console.error('Error fetching daily count:', error.message);
        return 0;
    }

    return data || 0;
}

/**
 * Atomically increment daily generation count and check limit
 * Uses Supabase RPC function for race-safe enforcement
 * 
 * @param {string} userId - User ID
 * @param {number} dailyLimit - Max allowed generations per day
 * @returns {Promise<{allowed: boolean, count: number, limit: number, message?: string}>}
 */
async function incrementAndCheckDailyLimit(userId, dailyLimit) {
    const { data, error } = await supabase.rpc('increment_daily_generation', {
        p_user_id: userId,
        p_daily_limit: dailyLimit
    });

    if (error) {
        console.error('Error in daily limit RPC:', error.message);
        // On error, allow the request but log it (fail-open for availability)
        // You could change to fail-closed for stricter security
        return { allowed: true, count: 0, limit: dailyLimit, error: error.message };
    }

    return data;
}

/**
 * Increment daily count after successful generation (legacy function name for compatibility)
 * Now uses database instead of in-memory storage
 * @param {string} userId - User ID
 */
export async function incrementDailyCount(userId) {
    // The increment already happened in enforceDailyLimit via RPC
    // This function is kept for API compatibility but is now a no-op
    // The actual increment happens atomically in enforceDailyLimit
    console.log(`📊 Daily generation tracked in DB for user: ${userId}`);
}

/**
 * Middleware to validate user's plan and credits from the database
 * This prevents plan spoofing by NOT trusting client-provided plan values
 */
export async function validatePlanAndCredits(req, res, next) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User authentication required'
            });
        }

        // Fetch ACTUAL plan and credits from database (not from request!)
        const { data, error } = await supabase
            .from('user_credits')
            .select('credits, plan, free_updates_remaining, plan_expires_at')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching user credits:', error.message);
            return res.status(500).json({
                error: 'Server Error',
                message: 'Unable to verify user plan'
            });
        }

        // If no record exists, create one with defaults
        if (!data || error?.code === 'PGRST116') {
            const { data: newData, error: insertError } = await supabase
                .from('user_credits')
                .insert({
                    user_id: userId,
                    credits: 50,
                    plan: 'free',
                    free_updates_remaining: 0
                })
                .select('credits, plan, free_updates_remaining, plan_expires_at')
                .single();

            if (insertError) {
                console.error('Error creating user credits:', insertError.message);
                return res.status(500).json({
                    error: 'Server Error',
                    message: 'Unable to initialize user credits'
                });
            }

            req.userCredits = newData.credits;
            req.userPlan = newData.plan;
            req.freeUpdatesRemaining = newData.free_updates_remaining || 0;
        } else {
            // Check if plan has expired
            let plan = data.plan;
            if (data.plan_expires_at && new Date(data.plan_expires_at) < new Date()) {
                // Plan expired - downgrade to free
                plan = 'free';
                console.log(`Plan expired for user ${userId}, downgrading to free`);

                // Update the database to reflect the downgrade
                await supabase
                    .from('user_credits')
                    .update({ plan: 'free', free_updates_remaining: 0 })
                    .eq('user_id', userId);
            }

            req.userCredits = data.credits;
            req.userPlan = plan;
            req.freeUpdatesRemaining = data.free_updates_remaining || 0;
        }

        // Log for debugging (no sensitive data)
        console.log(`User ${userId} verified: Plan=${req.userPlan}, Credits=${req.userCredits}`);

        next();
    } catch (error) {
        console.error('Plan validation error:', error.message);
        return res.status(500).json({
            error: 'Server Error',
            message: 'Unable to validate user plan'
        });
    }
}

/**
 * Middleware to check if user has sufficient credits for single report
 * Must be used AFTER validatePlanAndCredits middleware
 */
export function requireCredits(creditCost = CREDIT_COSTS.SINGLE_REPORT) {
    return (req, res, next) => {
        if (req.userCredits < creditCost) {
            return res.status(402).json({
                error: 'Insufficient Credits',
                message: `You need ${creditCost} credits for this operation. You have ${req.userCredits} credits.`,
                required: creditCost,
                available: req.userCredits
            });
        }

        // Store the cost for deduction after successful generation
        req.creditCost = creditCost;
        next();
    };
}

/**
 * Middleware to enforce daily generation limits per plan (PRODUCTION-SAFE)
 * Uses Supabase RPC for atomic increment + check (prevents race conditions)
 * Must be used AFTER validatePlanAndCredits middleware
 * 
 * EXECUTION ORDER:
 * 1. Check + Increment atomically via RPC
 * 2. If limit exceeded, RPC rolls back and returns error
 * 3. If allowed, proceed to next middleware
 */
export async function enforceDailyLimit(req, res, next) {
    const userId = req.user?.id;
    const plan = req.userPlan || 'free';
    const dailyLimit = DAILY_LIMITS[plan] || DAILY_LIMITS.free;

    try {
        // Atomic check + increment via database RPC
        const result = await incrementAndCheckDailyLimit(userId, dailyLimit);

        if (!result.allowed) {
            const resetTime = new Date();
            resetTime.setUTCHours(24, 0, 0, 0); // Midnight UTC
            const hoursUntilReset = Math.ceil((resetTime - new Date()) / (1000 * 60 * 60));

            return res.status(429).json({
                error: 'Daily Limit Exceeded',
                message: `You have reached your daily limit of ${dailyLimit} generations for the ${plan} plan. Your limit resets in ${hoursUntilReset} hours.`,
                dailyLimit: dailyLimit,
                used: result.count,
                plan: plan,
                hoursUntilReset: hoursUntilReset
            });
        }

        // Store current count for reference
        req.dailyGenerationsUsed = result.count;
        req.dailyGenerationsRemaining = dailyLimit - result.count;

        console.log(`📊 Daily limit checked: User ${userId} - ${result.count}/${dailyLimit} (${plan})`);
        next();
    } catch (error) {
        console.error('Daily limit enforcement error:', error.message);
        // Fail-open: Allow request on error to maintain availability
        // Change to fail-closed for stricter security
        next();
    }
}

/**
 * Middleware to check if user's plan allows bundle generation
 * Must be used AFTER validatePlanAndCredits middleware
 */
export function requireBundleAccess(req, res, next) {
    const allowedPlans = ['starter', 'pro'];

    if (!allowedPlans.includes(req.userPlan)) {
        return res.status(403).json({
            error: 'Upgrade Required',
            message: 'Developer Bundle is only available for Starter and Pro plans. Please upgrade your plan to access this feature.',
            currentPlan: req.userPlan
        });
    }

    // Check credits for bundle (4x single report cost)
    if (req.userCredits < CREDIT_COSTS.BUNDLE) {
        return res.status(402).json({
            error: 'Insufficient Credits',
            message: `You need ${CREDIT_COSTS.BUNDLE} credits for Developer Bundle. You have ${req.userCredits} credits.`,
            required: CREDIT_COSTS.BUNDLE,
            available: req.userCredits
        });
    }

    req.creditCost = CREDIT_COSTS.BUNDLE;
    next();
}

/**
 * Deduct credits from user's account
 * Should be called BEFORE generating content to prevent abuse
 */
export async function deductCreditsServer(userId, amount, currentCredits) {
    const newCredits = currentCredits - amount;

    // Use optimistic locking to prevent race conditions
    const { data, error } = await supabase
        .from('user_credits')
        .update({
            credits: newCredits,
            updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('credits', currentCredits)  // Only update if credits haven't changed
        .select('credits')
        .single();

    if (error || !data) {
        console.error('Credit deduction failed:', error?.message);
        return { success: false, error: 'Failed to deduct credits. Please try again.' };
    }

    return { success: true, newCredits: data.credits };
}

/**
 * @deprecated This function is deprecated as of the enterprise credit system.
 * Refunds are now admin-only via the admin_process_refund RPC.
 * 
 * DO NOT use this function for automatic refunds.
 * Keep for backwards compatibility only.
 */
export async function refundCreditsServer(userId, amount) {
    console.warn('⚠️ DEPRECATED: refundCreditsServer() called. Automatic refunds are no longer allowed.');
    console.warn('   Use admin refund flow instead: POST /api/admin/process-refund');

    // Return failure - automatic refunds are disabled
    return { success: false, error: 'Automatic refunds are disabled. Use admin refund flow.' };
}
