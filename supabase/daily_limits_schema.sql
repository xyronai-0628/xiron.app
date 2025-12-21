-- ============================================
-- DAILY GENERATION USAGE TABLE
-- Run this in Supabase SQL Editor
-- ============================================

-- Create the daily generation usage table
CREATE TABLE IF NOT EXISTS daily_generation_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    generation_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Composite unique constraint for atomic upsert
    CONSTRAINT unique_user_date UNIQUE (user_id, usage_date)
);

-- Index for fast lookups by user and date
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date 
ON daily_generation_usage(user_id, usage_date);

-- Enable Row Level Security
ALTER TABLE daily_generation_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own usage
CREATE POLICY "Users can view own usage" ON daily_generation_usage
    FOR SELECT USING (auth.uid() = user_id);

-- Policy: Service role can do everything (for backend)
CREATE POLICY "Service role full access" ON daily_generation_usage
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- ATOMIC INCREMENT RPC FUNCTION
-- This is the key to race-safe enforcement
-- ============================================

CREATE OR REPLACE FUNCTION increment_daily_generation(
    p_user_id UUID,
    p_daily_limit INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_count INTEGER;
BEGIN
    -- Atomic upsert: Insert new record or increment existing
    -- ON CONFLICT ensures only one record per user per day
    INSERT INTO daily_generation_usage (user_id, usage_date, generation_count)
    VALUES (p_user_id, CURRENT_DATE, 1)
    ON CONFLICT (user_id, usage_date)
    DO UPDATE SET 
        generation_count = daily_generation_usage.generation_count + 1,
        updated_at = NOW()
    RETURNING generation_count INTO v_current_count;
    
    -- Check if limit exceeded AFTER increment
    IF v_current_count > p_daily_limit THEN
        -- Rollback the increment since we exceeded the limit
        UPDATE daily_generation_usage 
        SET generation_count = generation_count - 1,
            updated_at = NOW()
        WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
        
        -- Return failure response
        RETURN json_build_object(
            'allowed', false,
            'count', v_current_count - 1,
            'limit', p_daily_limit,
            'message', 'Daily generation limit exceeded'
        );
    END IF;
    
    -- Return success response
    RETURN json_build_object(
        'allowed', true,
        'count', v_current_count,
        'limit', p_daily_limit
    );
END;
$$;

-- ============================================
-- HELPER FUNCTION: Get current daily count
-- ============================================

CREATE OR REPLACE FUNCTION get_daily_generation_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT generation_count INTO v_count
    FROM daily_generation_usage
    WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
    
    RETURN COALESCE(v_count, 0);
END;
$$;

-- ============================================
-- OPTIONAL: Auto-cleanup old records (run as cron)
-- Deletes records older than 7 days
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_daily_usage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM daily_generation_usage
    WHERE usage_date < CURRENT_DATE - INTERVAL '7 days';
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION increment_daily_generation(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_generation_count(UUID) TO authenticated;
