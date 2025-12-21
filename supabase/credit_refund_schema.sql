-- ============================================
-- ENTERPRISE-GRADE CREDIT & REFUND SYSTEM
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. CREDIT TRANSACTIONS TABLE (Audit Trail)
-- ============================================

CREATE TABLE IF NOT EXISTS credit_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Transaction details
    delta INTEGER NOT NULL,                    -- Positive = add, Negative = deduct
    balance_after INTEGER NOT NULL,            -- User's balance after this transaction
    
    -- Categorization
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'plan_purchase',      -- Credits from buying a plan
        'generation_cost',    -- Credits deducted for AI generation
        'admin_refund',       -- Admin-approved refund
        'plan_upgrade',       -- Credits from upgrade
        'plan_downgrade',     -- Credits reset on downgrade
        'expiry_reset',       -- Monthly credits reset
        'manual_adjustment'   -- Admin manual adjustment
    )),
    
    -- Reference & audit
    reason TEXT NOT NULL,                      -- Human-readable reason
    reference_id TEXT,                         -- Link to generation_id, payment_id, etc.
    reference_type TEXT,                       -- 'generation', 'payment', 'admin'
    
    -- Metadata
    admin_user_id UUID,                        -- If admin action, who did it
    metadata JSONB DEFAULT '{}',               -- Additional context
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_reference ON credit_transactions(reference_id);

-- Enable RLS
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (makes script re-runnable)
DROP POLICY IF EXISTS "Users can view own transactions" ON credit_transactions;
DROP POLICY IF EXISTS "Service role can insert" ON credit_transactions;

-- Users can only view their own transactions
CREATE POLICY "Users can view own transactions" ON credit_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Only service role can insert (backend only)
CREATE POLICY "Service role can insert" ON credit_transactions
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 2. GENERATION LOGS TABLE (AI Generation Audit)
-- ============================================

CREATE TABLE IF NOT EXISTS generation_logs (
    id BIGSERIAL PRIMARY KEY,
    generation_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Generation details
    generation_type TEXT NOT NULL CHECK (generation_type IN (
        'prd', 'architecture', 'database', 'userflow', 'bundle'
    )),
    credits_charged INTEGER NOT NULL,          -- Amount deducted
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Generation started
        'success',      -- Completed successfully
        'failed'        -- Failed (may be eligible for refund)
    )),
    
    -- Error tracking (for refund eligibility)
    -- STRUCTURED ERROR CODES:
    -- Platform faults (REFUNDABLE): PROVIDER_TIMEOUT, PROVIDER_OUTAGE, INTERNAL_5XX, RATE_LIMIT
    -- User faults (NOT refundable): USER_INPUT, CONTENT_POLICY, PLAN_RESTRICTED, USER_CANCELLED
    error_code TEXT CHECK (error_code IN (
        -- Platform faults (REFUNDABLE by admin)
        'PROVIDER_TIMEOUT',         -- AI provider timed out
        'PROVIDER_OUTAGE',          -- AI provider down/unavailable
        'INTERNAL_5XX',             -- Internal server error (5xx)
        'RATE_LIMIT',               -- Provider rate limit exceeded
        
        -- User faults (NOT refundable)
        'USER_INPUT',               -- Bad user input
        'CONTENT_POLICY',           -- Content blocked by AI policy
        'PLAN_RESTRICTED',          -- Feature not in user's plan
        'USER_CANCELLED',           -- User cancelled request
        
        -- Legacy codes (for backwards compatibility)
        'PLATFORM_ERROR',
        'API_TIMEOUT',
        'RATE_LIMIT_EXCEEDED',
        'BAD_INPUT',
        'CONTENT_FILTERED',
        NULL                        -- No error (success)
    )),
    error_message TEXT,                        -- Detailed error for debugging
    
    -- Refund tracking
    refund_status TEXT DEFAULT 'none' CHECK (refund_status IN (
        'none',         -- No refund requested/needed
        'eligible',     -- Failed with platform error
        'approved',     -- Admin approved refund
        'processed',    -- Refund credited
        'denied'        -- Refund denied
    )),
    refund_processed_at TIMESTAMPTZ,
    refund_admin_id UUID,
    refund_notes TEXT,
    
    -- Request context (for debugging)
    request_metadata JSONB DEFAULT '{}',       -- Project name, plan, etc.
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gen_logs_user ON generation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_gen_logs_status ON generation_logs(status);
CREATE INDEX IF NOT EXISTS idx_gen_logs_refund ON generation_logs(refund_status);
CREATE INDEX IF NOT EXISTS idx_gen_logs_created ON generation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_logs_generation_id ON generation_logs(generation_id);

-- Enable RLS
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (makes script re-runnable)
DROP POLICY IF EXISTS "Users can view own generation logs" ON generation_logs;
DROP POLICY IF EXISTS "Service role full access on generation_logs" ON generation_logs;

-- Users can view their own logs
CREATE POLICY "Users can view own generation logs" ON generation_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role full access on generation_logs" ON generation_logs
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 3. ATOMIC CREDIT DEDUCTION WITH LOGGING
-- ============================================

CREATE OR REPLACE FUNCTION deduct_credits_atomic(
    p_user_id UUID,
    p_amount INTEGER,
    p_generation_id UUID,
    p_generation_type TEXT,
    p_reason TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_credits INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Get current credits with row lock
    SELECT credits INTO v_current_credits
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF v_current_credits IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User credits not found'
        );
    END IF;
    
    IF v_current_credits < p_amount THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Insufficient credits',
            'required', p_amount,
            'available', v_current_credits
        );
    END IF;
    
    v_new_balance := v_current_credits - p_amount;
    
    -- Deduct credits
    UPDATE user_credits
    SET credits = v_new_balance, updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Log the transaction
    INSERT INTO credit_transactions (
        user_id, delta, balance_after, transaction_type, reason,
        reference_id, reference_type
    ) VALUES (
        p_user_id, -p_amount, v_new_balance, 'generation_cost', p_reason,
        p_generation_id::TEXT, 'generation'
    );
    
    -- Create generation log entry
    INSERT INTO generation_logs (
        generation_id, user_id, generation_type, credits_charged, status
    ) VALUES (
        p_generation_id, p_user_id, p_generation_type, p_amount, 'pending'
    );
    
    RETURN json_build_object(
        'success', true,
        'generation_id', p_generation_id,
        'credits_deducted', p_amount,
        'new_balance', v_new_balance
    );
END;
$$;

-- ============================================
-- 4. UPDATE GENERATION LOG STATUS
-- ============================================

CREATE OR REPLACE FUNCTION update_generation_status(
    p_generation_id UUID,
    p_status TEXT,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_refund_status TEXT;
BEGIN
    -- Determine refund eligibility based on error code (platform faults only)
    -- NOTE: RATE_LIMIT is NOT refundable - user should retry later
    IF p_status = 'failed' AND p_error_code IN (
        'PROVIDER_TIMEOUT', 'PROVIDER_OUTAGE', 'INTERNAL_5XX',
        'PLATFORM_ERROR', 'API_TIMEOUT'  -- Legacy codes only, NOT RATE_LIMIT
    ) THEN
        v_refund_status := 'eligible';
    ELSE
        v_refund_status := 'none';
    END IF;
    
    UPDATE generation_logs
    SET 
        status = p_status,
        error_code = p_error_code,
        error_message = p_error_message,
        refund_status = v_refund_status,
        completed_at = NOW()
    WHERE generation_id = p_generation_id;
    
    RETURN json_build_object(
        'success', true,
        'generation_id', p_generation_id,
        'status', p_status,
        'refund_eligible', v_refund_status = 'eligible'
    );
END;
$$;

-- ============================================
-- 5. ADMIN-ONLY REFUND FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION admin_process_refund(
    p_generation_id UUID,
    p_admin_user_id UUID,
    p_refund_notes TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log RECORD;
    v_current_credits INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Fetch generation log
    SELECT * INTO v_log
    FROM generation_logs
    WHERE generation_id = p_generation_id
    FOR UPDATE;
    
    -- Validation checks
    IF v_log IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Generation not found'
        );
    END IF;
    
    IF v_log.status != 'failed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Only failed generations can be refunded',
            'current_status', v_log.status
        );
    END IF;
    
    IF v_log.refund_status = 'processed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Refund already processed for this generation'
        );
    END IF;
    
    -- Check if error code is refundable (platform faults only - NOT rate limits)
    IF v_log.error_code NOT IN (
        'PROVIDER_TIMEOUT', 'PROVIDER_OUTAGE', 'INTERNAL_5XX',
        'PLATFORM_ERROR', 'API_TIMEOUT'
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Error type is not eligible for refund',
            'error_code', v_log.error_code
        );
    END IF;
    
    -- Get current credits
    SELECT credits INTO v_current_credits
    FROM user_credits
    WHERE user_id = v_log.user_id
    FOR UPDATE;
    
    v_new_balance := v_current_credits + v_log.credits_charged;
    
    -- Process refund atomically
    -- 1. Add credits back
    UPDATE user_credits
    SET credits = v_new_balance, updated_at = NOW()
    WHERE user_id = v_log.user_id;
    
    -- 2. Log the refund transaction
    INSERT INTO credit_transactions (
        user_id, delta, balance_after, transaction_type, reason,
        reference_id, reference_type, admin_user_id
    ) VALUES (
        v_log.user_id, v_log.credits_charged, v_new_balance, 'admin_refund',
        'Refund for failed generation: ' || v_log.error_code,
        p_generation_id::TEXT, 'generation', p_admin_user_id
    );
    
    -- 3. Update generation log
    UPDATE generation_logs
    SET 
        refund_status = 'processed',
        refund_processed_at = NOW(),
        refund_admin_id = p_admin_user_id,
        refund_notes = p_refund_notes
    WHERE generation_id = p_generation_id;
    
    RETURN json_build_object(
        'success', true,
        'generation_id', p_generation_id,
        'user_id', v_log.user_id,
        'credits_refunded', v_log.credits_charged,
        'new_balance', v_new_balance
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION deduct_credits_atomic(UUID, INTEGER, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_generation_status(UUID, TEXT, TEXT, TEXT) TO authenticated;
-- admin_process_refund is NOT granted to authenticated - service_role only
