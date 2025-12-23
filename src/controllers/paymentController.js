import { supabase } from '../config/supabase.js';
import { razorpay, verifyPaymentSignature, verifyWebhookSignature } from '../config/razorpay.js';

// Plan configurations with prices in paise (100 paise = 1 INR)
const PLAN_CONFIG = {
    starter: {
        credits: 100,
        freeUpdates: 1,
        priceInPaise: 14900, // ₹149
        name: 'Starter Plan'
    },
    pro: {
        credits: 200,
        freeUpdates: 3,
        priceInPaise: 29900, // ₹299
        name: 'Pro Plan'
    }
};

/**
 * Create a Razorpay order
 * POST /api/create-order
 */
export async function createOrder(req, res) {
    if (!razorpay) {
        return res.status(503).json({
            error: 'Payment Service Unavailable',
            message: 'Payment gateway is not configured. Please contact support.'
        });
    }

    const userId = req.user.id;
    const { planId } = req.body;

    try {
        if (!planId || !PLAN_CONFIG[planId]) {
            return res.status(400).json({
                error: 'Invalid Plan',
                message: 'Please select a valid plan (starter or pro)'
            });
        }

        const planConfig = PLAN_CONFIG[planId];

        const shortUserId = userId.slice(-8);
        const shortTimestamp = Date.now().toString().slice(-10);
        const order = await razorpay.orders.create({
            amount: planConfig.priceInPaise,
            currency: 'INR',
            receipt: `rcpt_${shortUserId}_${shortTimestamp}`,
            notes: {
                userId: userId,
                planId: planId
            }
        });

        // FIX: Store amount/currency in DB for webhook validation
        const { error: insertError } = await supabase
            .from('payments')
            .insert({
                user_id: userId,
                razorpay_order_id: order.id,
                amount: planConfig.priceInPaise,
                currency: 'INR',
                plan_id: planId,
                status: 'created',
                credits_added: false,
                processing: false  // FIX: Race-condition lock flag
            });

        if (insertError) {
            console.error('Error saving order:', insertError);
        }

        console.log(`📦 Order created for user ${userId}: ${order.id}`);

        res.json({
            success: true,
            orderId: order.id,
            amount: planConfig.priceInPaise,
            currency: 'INR',
            keyId: process.env.RAZORPAY_KEY_ID,
            planName: planConfig.name
        });

    } catch (error) {
        console.error('Create order error:', error.message);
        res.status(500).json({
            error: 'Order Creation Failed',
            message: error.message || 'Failed to create payment order. Please try again.'
        });
    }
}

/**
 * Verify payment after successful checkout
 * POST /api/verify-payment
 * 
 * ⚠️ SECURITY: Only verifies signature. Credits added via webhook ONLY.
 * FIX: Fetch plan from DB using order_id, never trust frontend planId
 */
export async function verifyPayment(req, res) {
    const userId = req.user.id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    // FIX: Removed planId from destructuring - never trust frontend

    try {
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                error: 'Invalid Request',
                message: 'Missing payment verification data'
            });
        }

        // FIX: Fetch payment record from DB to get trusted plan_id
        const { data: paymentRecord, error: fetchError } = await supabase
            .from('payments')
            .select('plan_id, user_id, amount')
            .eq('razorpay_order_id', razorpay_order_id)
            .single();

        if (fetchError || !paymentRecord) {
            return res.status(404).json({
                error: 'Order Not Found',
                message: 'Payment order not found in our records'
            });
        }

        // FIX: Verify this order belongs to the authenticated user
        if (paymentRecord.user_id !== userId) {
            console.error(`❌ User ${userId} tried to verify order belonging to ${paymentRecord.user_id}`);
            return res.status(403).json({
                error: 'Forbidden',
                message: 'This order does not belong to you'
            });
        }

        // FIX: Use trusted plan_id from DB, not from frontend
        const trustedPlanId = paymentRecord.plan_id;
        const planConfig = PLAN_CONFIG[trustedPlanId];

        if (!planConfig) {
            return res.status(400).json({
                error: 'Invalid Plan',
                message: 'Invalid plan in order record'
            });
        }

        const isValid = verifyPaymentSignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValid) {
            console.error(`❌ Invalid signature for order ${razorpay_order_id}`);
            await supabase
                .from('payments')
                .update({ status: 'signature_failed', updated_at: new Date().toISOString() })
                .eq('razorpay_order_id', razorpay_order_id);

            return res.status(400).json({
                error: 'Payment Verification Failed',
                message: 'Payment signature verification failed. Please contact support.'
            });
        }

        await supabase
            .from('payments')
            .update({
                razorpay_payment_id: razorpay_payment_id,
                razorpay_signature: razorpay_signature,
                status: 'verified',
                updated_at: new Date().toISOString()
            })
            .eq('razorpay_order_id', razorpay_order_id);

        console.log(`🔐 Payment signature verified for order ${razorpay_order_id}`);

        const { data: currentData } = await supabase
            .from('user_credits')
            .select('credits, plan')
            .eq('user_id', userId)
            .single();

        res.json({
            success: true,
            message: 'Payment verified! Credits will be added shortly.',
            pendingCredits: planConfig.credits,
            currentCredits: currentData?.credits || 0,
            currentPlan: currentData?.plan || 'free',
            note: 'Credits are processed via secure webhook.'
        });

    } catch (error) {
        console.error('Payment verification error:', error.message);
        res.status(500).json({
            error: 'Payment Verification Failed',
            message: 'Failed to verify payment. Please contact support if amount was deducted.'
        });
    }
}

/**
 * Handle Razorpay webhook events
 * POST /api/razorpay-webhook
 * 
 * FIX: Uses req.rawBody for signature verification (set in index.js middleware)
 * ✅ SOURCE OF TRUTH for payment success - credits added here ONLY
 */
export async function handleWebhook(req, res) {
    const signature = req.headers['x-razorpay-signature'];

    // FIX: Use raw body for signature verification (Express-safe)
    // req.rawBody should be set by express.raw() middleware in index.js
    const rawBody = req.rawBody || req.body;
    const bodyString = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

    try {
        const isValid = verifyWebhookSignature(bodyString, signature);

        if (!isValid) {
            console.error('❌ Invalid webhook signature - possible attack!');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        // Parse body if it was raw
        const parsedBody = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;
        const event = parsedBody.event;
        const payload = parsedBody.payload;

        console.log(`📨 Webhook received: ${event}`);

        switch (event) {
            case 'payment.captured':
                await handlePaymentCaptured(payload);
                break;

            case 'payment.failed':
                await handlePaymentFailed(payload);
                break;

            case 'order.paid':
                console.log(`📦 Order paid confirmation: ${payload.order.entity.id}`);
                break;

            default:
                console.log(`ℹ️ Unhandled webhook event: ${event}`);
        }

        res.status(200).json({ received: true });

    } catch (error) {
        console.error('Webhook handling error:', error.message);
        res.status(200).json({ received: true, error: error.message });
    }
}

/**
 * Handle payment.captured event - THE ONLY PLACE CREDITS ARE ADDED
 * 
 * FIX 1: Race-condition protection via row-level processing lock
 * FIX 2: Amount/currency validation against stored record
 * FIX 3: Plan fetched from DB only, never from webhook notes
 */
async function handlePaymentCaptured(payload) {
    const paymentEntity = payload.payment.entity;
    const orderId = paymentEntity.order_id;
    const paymentId = paymentEntity.id;
    const webhookAmount = paymentEntity.amount;      // Amount from webhook
    const webhookCurrency = paymentEntity.currency;  // Currency from webhook

    console.log(`💰 Processing payment.captured for order: ${orderId}`);

    // FIX: Atomic lock acquisition using UPDATE with WHERE clause
    // This prevents race conditions when multiple webhooks arrive simultaneously
    const { data: lockedRecord, error: lockError } = await supabase
        .from('payments')
        .update({
            processing: true,
            updated_at: new Date().toISOString()
        })
        .eq('razorpay_order_id', orderId)
        .eq('credits_added', false)
        .eq('processing', false)  // Only lock if not already processing
        .select('*')
        .single();

    if (lockError || !lockedRecord) {
        // Either record doesn't exist, already processed, or being processed
        console.log(`⚠️ Order ${orderId}: Already processed or being processed (race-condition guard)`);
        return;
    }

    try {
        // FIX: Validate amount and currency match stored record
        if (lockedRecord.amount !== webhookAmount) {
            console.error(`❌ Amount mismatch for order ${orderId}: DB=${lockedRecord.amount}, Webhook=${webhookAmount}`);
            await releaseProcessingLock(orderId, 'amount_mismatch');
            return;
        }

        if (lockedRecord.currency !== webhookCurrency) {
            console.error(`❌ Currency mismatch for order ${orderId}: DB=${lockedRecord.currency}, Webhook=${webhookCurrency}`);
            await releaseProcessingLock(orderId, 'currency_mismatch');
            return;
        }

        // FIX: Use plan_id from DB record ONLY, never from webhook notes
        const trustedPlanId = lockedRecord.plan_id;
        const planConfig = PLAN_CONFIG[trustedPlanId];

        if (!planConfig) {
            console.error(`❌ Invalid plan for order ${orderId}: ${trustedPlanId}`);
            await releaseProcessingLock(orderId, 'invalid_plan');
            return;
        }

        const targetUserId = lockedRecord.user_id;

        // Get current user credits AND plan
        const { data: currentData, error: creditsError } = await supabase
            .from('user_credits')
            .select('credits, plan')
            .eq('user_id', targetUserId)
            .single();

        if (creditsError && creditsError.code !== 'PGRST116') {
            console.error('Error fetching user credits:', creditsError);
            await releaseProcessingLock(orderId, 'credits_fetch_error');
            return;
        }

        const existingCredits = currentData?.credits || 0;
        const currentPlan = currentData?.plan || 'free';

        // CREDIT ROLLOVER POLICY:
        // 🔼 ROLLOVER ALLOWED: Upgrades (Starter→Pro) & Same-plan renewals (Starter→Starter, Pro→Pro)
        // 🚫 NO ROLLOVER: Free→Paid (free credits don't rollover), Downgrades (handled in /api/change-plan)
        let newCredits;
        if (currentPlan === 'free') {
            // Free → Paid: No rollover (free credits don't carry over)
            newCredits = planConfig.credits;
            console.log(`📊 Free → ${trustedPlanId}: Credits set to ${newCredits}`);
        } else {
            // Paid → Paid: ROLLOVER (upgrades + same-plan renewals)
            // Example: Starter(40)→Pro = 40+200, Starter(40)→Starter = 40+100
            newCredits = existingCredits + planConfig.credits;
            console.log(`📊 ${currentPlan} → ${trustedPlanId}: Rollover ${existingCredits} + ${planConfig.credits} = ${newCredits}`);
        }

        const planExpiresAt = new Date();
        planExpiresAt.setDate(planExpiresAt.getDate() + 30);

        // Update or insert user credits
        if (currentData) {
            const { error: updateError } = await supabase
                .from('user_credits')
                .update({
                    credits: newCredits,
                    plan: trustedPlanId,
                    free_updates_remaining: planConfig.freeUpdates,
                    plan_expires_at: planExpiresAt.toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', targetUserId);

            if (updateError) {
                console.error('Error updating user credits:', updateError);
                await releaseProcessingLock(orderId, 'credits_update_error');
                return;
            }
        } else {
            const { error: insertError } = await supabase
                .from('user_credits')
                .insert({
                    user_id: targetUserId,
                    credits: newCredits,
                    plan: trustedPlanId,
                    free_updates_remaining: planConfig.freeUpdates,
                    plan_expires_at: planExpiresAt.toISOString()
                });

            if (insertError) {
                console.error('Error inserting user credits:', insertError);
                await releaseProcessingLock(orderId, 'credits_insert_error');
                return;
            }
        }

        // Mark as complete - credits_added = true (idempotency), processing = false
        await supabase
            .from('payments')
            .update({
                status: 'confirmed',
                credits_added: true,
                processing: false,
                razorpay_payment_id: paymentId,
                updated_at: new Date().toISOString()
            })
            .eq('razorpay_order_id', orderId);

        console.log(`✅ Credits added: User ${targetUserId} now has ${newCredits} credits (${planConfig.name})`);

    } catch (error) {
        console.error(`Error processing payment ${orderId}:`, error.message);
        await releaseProcessingLock(orderId, 'processing_error');
    }
}

/**
 * Helper: Release processing lock on error
 */
async function releaseProcessingLock(orderId, errorReason) {
    await supabase
        .from('payments')
        .update({
            processing: false,
            error_message: errorReason,
            updated_at: new Date().toISOString()
        })
        .eq('razorpay_order_id', orderId);
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(payload) {
    const paymentEntity = payload.payment.entity;
    const orderId = paymentEntity.order_id;
    const errorDescription = paymentEntity.error_description || 'Payment failed';

    console.log(`❌ Payment failed for order: ${orderId} - ${errorDescription}`);

    await supabase
        .from('payments')
        .update({
            status: 'failed',
            error_message: errorDescription,
            updated_at: new Date().toISOString()
        })
        .eq('razorpay_order_id', orderId);
}

/**
 * Change user's plan (for downgrades)
 * POST /api/change-plan
 */
export async function changePlan(req, res) {
    const userId = req.user.id;
    const { targetPlan } = req.body;

    try {
        const validPlans = ['free', 'starter', 'pro'];
        if (!targetPlan || !validPlans.includes(targetPlan)) {
            return res.status(400).json({
                error: 'Invalid Plan',
                message: 'Please select a valid plan (free, starter, or pro)'
            });
        }

        const { data: currentData, error: fetchError } = await supabase
            .from('user_credits')
            .select('credits, plan, free_updates_remaining')
            .eq('user_id', userId)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            throw fetchError;
        }

        const currentPlan = currentData?.plan || 'free';
        const currentCredits = currentData?.credits || 0;
        const planHierarchy = { free: 0, starter: 1, pro: 2 };

        if (planHierarchy[targetPlan] >= planHierarchy[currentPlan]) {
            return res.status(400).json({
                error: 'Invalid Operation',
                message: 'This endpoint is for downgrades only. Use the payment flow for upgrades.'
            });
        }

        let newCredits;
        let freeUpdates;
        let planExpiresAt = null;

        if (targetPlan === 'free') {
            // Downgrade to Free: Reset to 50 credits, no rollover
            newCredits = 50;
            freeUpdates = 0;
        } else if (targetPlan === 'starter') {
            // Downgrade to Starter: Get only Starter credits (no rollover)
            // Only UPGRADES carry over existing credits
            const starterConfig = PLAN_CONFIG.starter;
            newCredits = starterConfig.credits; // Just 100, not existing + 100
            freeUpdates = starterConfig.freeUpdates;
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            planExpiresAt = expiryDate.toISOString();
        }

        const updateData = {
            credits: newCredits,
            plan: targetPlan,
            free_updates_remaining: freeUpdates,
            updated_at: new Date().toISOString()
        };

        if (planExpiresAt) {
            updateData.plan_expires_at = planExpiresAt;
        } else if (targetPlan === 'free') {
            updateData.plan_expires_at = null;
        }

        await supabase
            .from('user_credits')
            .update(updateData)
            .eq('user_id', userId);

        console.log(`✅ Plan changed: ${userId} ${currentPlan} → ${targetPlan}`);

        res.json({
            success: true,
            message: `Successfully changed to ${targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)} plan`,
            previousPlan: currentPlan,
            newPlan: targetPlan,
            previousCredits: currentCredits,
            newCredits: newCredits,
            freeUpdates: freeUpdates,
            planExpiresAt: planExpiresAt
        });

    } catch (error) {
        console.error('Change plan error:', error.message);
        res.status(500).json({
            error: 'Plan Change Failed',
            message: 'Failed to change plan. Please try again or contact support.'
        });
    }
}

export async function processPayment(req, res) {
    return res.status(410).json({
        error: 'Deprecated',
        message: 'This endpoint is deprecated. Use /api/create-order instead.'
    });
}
