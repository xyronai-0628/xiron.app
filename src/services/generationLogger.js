import { supabase } from '../config/supabase.js';
import { randomUUID } from 'crypto';

/**
 * GENERATION LOGGER SERVICE (HARDENED)
 * 
 * Enterprise-grade logging for all AI generations.
 * Provides audit trail for credit usage and refund eligibility.
 * 
 * SECURITY GUARANTEES:
 * - Atomic credit deduction + logging via single RPC
 * - Idempotency protection via requestId
 * - Structured error codes for refund eligibility
 * - No in-memory state (serverless safe)
 * - Multi-instance safe
 */

/**
 * STRUCTURED ERROR CODES
 * 
 * Platform faults (REFUNDABLE by admin):
 * - PROVIDER_TIMEOUT: AI provider timed out
 * - PROVIDER_OUTAGE: AI provider down/unavailable
 * - INTERNAL_5XX: Internal server error
 * - RATE_LIMIT: Provider rate limit exceeded
 * 
 * User faults (NOT refundable):
 * - USER_INPUT: Bad user input
 * - CONTENT_POLICY: Content blocked by AI policy
 * - PLAN_RESTRICTED: Feature not in user's plan
 * - USER_CANCELLED: User cancelled request
 */
export const ERROR_CODES = {
    // Platform faults (REFUNDABLE by admin)
    PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
    PROVIDER_OUTAGE: 'PROVIDER_OUTAGE',
    INTERNAL_5XX: 'INTERNAL_5XX',
    RATE_LIMIT: 'RATE_LIMIT',

    // User faults (NOT refundable)
    USER_INPUT: 'USER_INPUT',
    CONTENT_POLICY: 'CONTENT_POLICY',
    PLAN_RESTRICTED: 'PLAN_RESTRICTED',
    USER_CANCELLED: 'USER_CANCELLED'
};

// Error codes eligible for admin refund (PLATFORM FAULTS ONLY)
// NOTE: RATE_LIMIT is NOT refundable - user should retry later
export const REFUNDABLE_ERRORS = [
    ERROR_CODES.PROVIDER_TIMEOUT,
    ERROR_CODES.PROVIDER_OUTAGE,
    ERROR_CODES.INTERNAL_5XX
];

/**
 * Classify an error into structured error code
 * @param {Error} error - The caught error
 * @returns {string} - Structured error code
 */
export function classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode || 0;

    // 5xx server errors
    if (statusCode >= 500 && statusCode < 600) {
        return ERROR_CODES.INTERNAL_5XX;
    }

    // Rate limits (429 or message-based)
    if (statusCode === 429 || (message.includes('rate') && message.includes('limit'))) {
        return ERROR_CODES.RATE_LIMIT;
    }

    // Timeouts
    if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
        return ERROR_CODES.PROVIDER_TIMEOUT;
    }

    // Provider outages
    if (message.includes('unavailable') || message.includes('503') || message.includes('502') ||
        message.includes('connection refused') || message.includes('econnrefused')) {
        return ERROR_CODES.PROVIDER_OUTAGE;
    }

    // Content policy violations
    if (message.includes('content') && (message.includes('filter') || message.includes('block') ||
        message.includes('policy') || message.includes('flagged'))) {
        return ERROR_CODES.CONTENT_POLICY;
    }

    // Bad user input
    if (message.includes('invalid') || message.includes('required') || message.includes('missing') ||
        message.includes('validation')) {
        return ERROR_CODES.USER_INPUT;
    }

    // Plan restrictions
    if (message.includes('plan') || message.includes('upgrade') || message.includes('restricted')) {
        return ERROR_CODES.PLAN_RESTRICTED;
    }

    // Default to internal error (platform fault - gives benefit of doubt)
    return ERROR_CODES.INTERNAL_5XX;
}

/**
 * Check if error code is refundable
 */
export function isRefundableError(errorCode) {
    return REFUNDABLE_ERRORS.includes(errorCode);
}

/**
 * Deduct credits atomically with idempotency protection
 * MUST be called BEFORE AI generation
 * 
 * @param {string} userId - User ID
 * @param {number} creditAmount - Credits to deduct
 * @param {string} generationType - Type (prd, architecture, database, userflow, bundle)
 * @param {string} reason - Human-readable reason
 * @param {string|null} requestId - Optional idempotency key (if provided, prevents double-charging)
 * @returns {Promise<{success: boolean, generationId?: string, newBalance?: number, error?: string, cached?: boolean}>}
 */
export async function deductCreditsWithLog(userId, creditAmount, generationType, reason, requestId = null) {
    // Generate new ID or use provided requestId for idempotency
    const generationId = requestId || randomUUID();

    // IDEMPOTENCY CHECK: If requestId provided, check if already processed
    // SECURITY: Must check BOTH generation_id AND user_id to prevent cross-user replay attacks
    if (requestId) {
        const { data: existing } = await supabase
            .from('generation_logs')
            .select('generation_id, user_id, status, credits_charged')
            .eq('generation_id', requestId)
            .eq('user_id', userId)  // CRITICAL: Prevent cross-user replay
            .single();

        if (existing) {
            console.log(`🔄 Idempotency hit: Request ${requestId} for user ${userId} already processed`);
            // Return cached result without deducting again
            const { data: userCredits } = await supabase
                .from('user_credits')
                .select('credits')
                .eq('user_id', userId)
                .single();

            return {
                success: true,
                generationId: existing.generation_id,
                newBalance: userCredits?.credits || 0,
                cached: true
            };
        }
    }

    // ATOMIC: Deduct credits + create log in single RPC
    const { data, error } = await supabase.rpc('deduct_credits_atomic', {
        p_user_id: userId,
        p_amount: creditAmount,
        p_generation_id: generationId,
        p_generation_type: generationType,
        p_reason: reason
    });

    if (error) {
        console.error('Credit deduction RPC error:', error.message);
        return { success: false, error: error.message };
    }

    if (!data.success) {
        return { success: false, error: data.error };
    }

    console.log(`💳 Credits deducted: ${creditAmount} | Gen ID: ${generationId} | Balance: ${data.new_balance}`);

    return {
        success: true,
        generationId: data.generation_id,
        newBalance: data.new_balance,
        cached: false
    };
}

/**
 * Update generation log with final status
 * MUST be called after AI generation completes or fails
 * 
 * Logs:
 * - generation_id, user_id, type
 * - credit_cost, status (success/failed)
 * - error_code (structured), error_message
 * - updated_at, completed_at
 * 
 * @param {string} generationId - Generation ID from deductCreditsWithLog
 * @param {boolean} success - Whether generation succeeded
 * @param {Error|null} error - Error if failed
 * @returns {Promise<{success: boolean, refundEligible: boolean}>}
 */
export async function updateGenerationStatus(generationId, success, error = null) {
    const status = success ? 'success' : 'failed';
    const errorCode = error ? classifyError(error) : null;
    const errorMessage = error ? error.message?.substring(0, 1000) : null; // Truncate long errors

    const { data, error: rpcError } = await supabase.rpc('update_generation_status', {
        p_generation_id: generationId,
        p_status: status,
        p_error_code: errorCode,
        p_error_message: errorMessage
    });

    if (rpcError) {
        console.error('Generation status update error:', rpcError.message);
        return { success: false, refundEligible: false };
    }

    const refundEligible = status === 'failed' && isRefundableError(errorCode);

    if (status === 'failed') {
        console.log(`❌ Generation failed: ${generationId} | Code: ${errorCode} | Refund eligible: ${refundEligible}`);
    } else {
        console.log(`✅ Generation success: ${generationId}`);
    }

    return {
        success: true,
        refundEligible
    };
}

/**
 * Check if a generation is eligible for refund
 * For admin UI display purposes
 */
export async function checkRefundEligibility(generationId) {
    const { data, error } = await supabase
        .from('generation_logs')
        .select('status, error_code, refund_status')
        .eq('generation_id', generationId)
        .single();

    if (error || !data) {
        return { eligible: false, reason: 'Generation not found' };
    }

    if (data.status !== 'failed') {
        return { eligible: false, reason: 'Only failed generations can be refunded' };
    }

    if (data.refund_status === 'processed') {
        return { eligible: false, reason: 'Refund already processed' };
    }

    if (!isRefundableError(data.error_code)) {
        return { eligible: false, reason: `Error type ${data.error_code} is not refundable (user fault)` };
    }

    return { eligible: true, reason: 'Platform fault - eligible for admin refund' };
}

/**
 * Get generation by ID (for debugging/admin)
 */
export async function getGeneration(generationId) {
    const { data, error } = await supabase
        .from('generation_logs')
        .select('*')
        .eq('generation_id', generationId)
        .single();

    if (error) {
        return null;
    }

    return data;
}
