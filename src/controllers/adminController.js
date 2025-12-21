import { supabase } from '../config/supabase.js';

/**
 * ADMIN REFUND CONTROLLER
 * 
 * Enterprise-grade admin-only refund system.
 * NO public refund API - all refunds require admin authentication.
 * 
 * Refund is allowed ONLY if:
 * 1. Generation exists and is failed
 * 2. Error code is a platform fault (PLATFORM_ERROR, PROVIDER_OUTAGE, etc.)
 * 3. Refund hasn't been processed already
 */

// List of admin user IDs (should be loaded from config/DB in production)
// For now, add admin IDs here
const ADMIN_USER_IDS = [
    // Add your admin user IDs here
    // Example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
];

/**
 * Middleware to check if user is admin
 */
export function requireAdmin(req, res, next) {
    const userId = req.user?.id;

    // Check if user ID is in admin list
    // In production, this should check a database or use role-based auth
    if (!ADMIN_USER_IDS.includes(userId)) {
        console.warn(`⚠️ Non-admin user ${userId} attempted admin action`);
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access required'
        });
    }

    req.isAdmin = true;
    next();
}

/**
 * Get list of refund-eligible generations
 * GET /api/admin/refund-queue
 */
export async function getRefundQueue(req, res) {
    try {
        const { data, error } = await supabase
            .from('generation_logs')
            .select(`
                generation_id,
                user_id,
                generation_type,
                credits_charged,
                status,
                error_code,
                error_message,
                refund_status,
                created_at
            `)
            .eq('status', 'failed')
            .eq('refund_status', 'eligible')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            queue: data,
            count: data.length
        });

    } catch (error) {
        console.error('Error fetching refund queue:', error.message);
        res.status(500).json({
            error: 'Failed to fetch refund queue',
            message: error.message
        });
    }
}

/**
 * Get generation details for refund review
 * GET /api/admin/generation/:generationId
 */
export async function getGenerationDetails(req, res) {
    const { generationId } = req.params;

    try {
        const { data: generation, error: genError } = await supabase
            .from('generation_logs')
            .select('*')
            .eq('generation_id', generationId)
            .single();

        if (genError || !generation) {
            return res.status(404).json({
                error: 'Generation not found'
            });
        }

        // Also get the credit transaction
        const { data: transaction } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('reference_id', generationId)
            .single();

        res.json({
            success: true,
            generation,
            transaction
        });

    } catch (error) {
        console.error('Error fetching generation details:', error.message);
        res.status(500).json({
            error: 'Failed to fetch generation details',
            message: error.message
        });
    }
}

/**
 * Process refund for a failed generation
 * POST /api/admin/process-refund
 * 
 * Body: { generationId, notes }
 */
export async function processRefund(req, res) {
    const adminUserId = req.user.id;
    const { generationId, notes } = req.body;

    if (!generationId) {
        return res.status(400).json({
            error: 'Generation ID required'
        });
    }

    try {
        // Use the atomic RPC function
        const { data, error } = await supabase.rpc('admin_process_refund', {
            p_generation_id: generationId,
            p_admin_user_id: adminUserId,
            p_refund_notes: notes || 'Admin approved refund'
        });

        if (error) {
            console.error('Refund RPC error:', error.message);
            return res.status(500).json({
                error: 'Refund processing failed',
                message: error.message
            });
        }

        if (!data.success) {
            return res.status(400).json({
                error: 'Refund not allowed',
                message: data.error,
                details: data
            });
        }

        console.log(`✅ Refund processed by admin ${adminUserId}: Gen ${generationId} - ${data.credits_refunded} credits`);

        res.json({
            success: true,
            message: 'Refund processed successfully',
            ...data
        });

    } catch (error) {
        console.error('Error processing refund:', error.message);
        res.status(500).json({
            error: 'Failed to process refund',
            message: error.message
        });
    }
}

/**
 * Deny a refund request
 * POST /api/admin/deny-refund
 */
export async function denyRefund(req, res) {
    const adminUserId = req.user.id;
    const { generationId, reason } = req.body;

    if (!generationId || !reason) {
        return res.status(400).json({
            error: 'Generation ID and reason required'
        });
    }

    try {
        const { error } = await supabase
            .from('generation_logs')
            .update({
                refund_status: 'denied',
                refund_admin_id: adminUserId,
                refund_notes: reason
            })
            .eq('generation_id', generationId);

        if (error) {
            throw error;
        }

        console.log(`❌ Refund denied by admin ${adminUserId}: Gen ${generationId} - ${reason}`);

        res.json({
            success: true,
            message: 'Refund denied',
            generationId,
            reason
        });

    } catch (error) {
        console.error('Error denying refund:', error.message);
        res.status(500).json({
            error: 'Failed to deny refund',
            message: error.message
        });
    }
}

/**
 * Get credit transaction history for a user (admin view)
 * GET /api/admin/user-transactions/:userId
 */
export async function getUserTransactions(req, res) {
    const { userId } = req.params;

    try {
        const { data, error } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            transactions: data,
            count: data.length
        });

    } catch (error) {
        console.error('Error fetching user transactions:', error.message);
        res.status(500).json({
            error: 'Failed to fetch transactions',
            message: error.message
        });
    }
}
