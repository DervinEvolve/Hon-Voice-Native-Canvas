-- Complete Migration to add ALL missing profile fields
-- This migration adds all columns that might be missing from the profiles table

-- First, let's check what columns currently exist
DO $$
DECLARE
    col_exists BOOLEAN;
BEGIN
    -- Check and add wallet_address if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'wallet_address'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN wallet_address TEXT;
        RAISE NOTICE 'Added wallet_address column';
    ELSE
        RAISE NOTICE 'wallet_address column already exists';
    END IF;
    
    -- Check and add first_name if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'first_name'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN first_name TEXT;
        RAISE NOTICE 'Added first_name column';
    ELSE
        RAISE NOTICE 'first_name column already exists';
    END IF;
    
    -- Check and add last_name if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'last_name'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN last_name TEXT;
        RAISE NOTICE 'Added last_name column';
    ELSE
        RAISE NOTICE 'last_name column already exists';
    END IF;
    
    -- Check and add youtube if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'youtube'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN youtube TEXT;
        RAISE NOTICE 'Added youtube column';
    ELSE
        RAISE NOTICE 'youtube column already exists';
    END IF;
    
    -- Check and add x if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'x'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN x TEXT;
        RAISE NOTICE 'Added x column';
    ELSE
        RAISE NOTICE 'x column already exists';
    END IF;
    
    -- Check and add linkedin if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'linkedin'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN linkedin TEXT;
        RAISE NOTICE 'Added linkedin column';
    ELSE
        RAISE NOTICE 'linkedin column already exists';
    END IF;
    
    -- Check and add thread if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'thread'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN thread TEXT;
        RAISE NOTICE 'Added thread column';
    ELSE
        RAISE NOTICE 'thread column already exists';
    END IF;
    
    -- Check and add display_name if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'display_name'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN display_name TEXT;
        RAISE NOTICE 'Added display_name column';
    ELSE
        RAISE NOTICE 'display_name column already exists';
    END IF;
    
    -- Check and add email if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'email'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN email TEXT;
        RAISE NOTICE 'Added email column';
    ELSE
        RAISE NOTICE 'email column already exists';
    END IF;
    
    -- Check and add social_links if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'social_links'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN social_links JSONB DEFAULT '{}';
        RAISE NOTICE 'Added social_links column';
    ELSE
        RAISE NOTICE 'social_links column already exists';
    END IF;
    
    -- Check and add preferences if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'preferences'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN preferences JSONB DEFAULT '{}';
        RAISE NOTICE 'Added preferences column';
    ELSE
        RAISE NOTICE 'preferences column already exists';
    END IF;
    
    -- Check and add subscription_tier if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'subscription_tier'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN subscription_tier TEXT DEFAULT 'free';
        RAISE NOTICE 'Added subscription_tier column';
    ELSE
        RAISE NOTICE 'subscription_tier column already exists';
    END IF;
    
    -- Check and add subscription_status if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'subscription_status'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN subscription_status TEXT DEFAULT 'inactive';
        RAISE NOTICE 'Added subscription_status column';
    ELSE
        RAISE NOTICE 'subscription_status column already exists';
    END IF;
    
    -- Check and add subscription_expiry if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'subscription_expiry'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN subscription_expiry TIMESTAMP WITH TIME ZONE;
        RAISE NOTICE 'Added subscription_expiry column';
    ELSE
        RAISE NOTICE 'subscription_expiry column already exists';
    END IF;
    
    -- Check and add is_verified if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'is_verified'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Added is_verified column';
    ELSE
        RAISE NOTICE 'is_verified column already exists';
    END IF;
    
    -- Check and add is_creator if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'is_creator'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN is_creator BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Added is_creator column';
    ELSE
        RAISE NOTICE 'is_creator column already exists';
    END IF;
    
    -- Check and add created_at if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'created_at'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
        RAISE NOTICE 'Added created_at column';
    ELSE
        RAISE NOTICE 'created_at column already exists';
    END IF;
    
    -- Check and add updated_at if it doesn't exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'updated_at'
        AND table_schema = 'public'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        ALTER TABLE public.profiles ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();
        RAISE NOTICE 'Added updated_at column';
    ELSE
        RAISE NOTICE 'updated_at column already exists';
    END IF;
    
END $$;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.wallet_address IS 'User wallet address for crypto authentication';
COMMENT ON COLUMN public.profiles.first_name IS 'User first name';
COMMENT ON COLUMN public.profiles.last_name IS 'User last name';
COMMENT ON COLUMN public.profiles.youtube IS 'YouTube channel URL';
COMMENT ON COLUMN public.profiles.x IS 'X (Twitter) profile URL';
COMMENT ON COLUMN public.profiles.linkedin IS 'LinkedIn profile URL';
COMMENT ON COLUMN public.profiles.thread IS 'Thread profile URL';
COMMENT ON COLUMN public.profiles.display_name IS 'User display name';
COMMENT ON COLUMN public.profiles.email IS 'User email address';
COMMENT ON COLUMN public.profiles.social_links IS 'JSON object containing social media links';
COMMENT ON COLUMN public.profiles.preferences IS 'JSON object containing user preferences';
COMMENT ON COLUMN public.profiles.subscription_tier IS 'User subscription tier (free, pro, premium)';
COMMENT ON COLUMN public.profiles.subscription_status IS 'User subscription status';
COMMENT ON COLUMN public.profiles.subscription_expiry IS 'When the subscription expires';
COMMENT ON COLUMN public.profiles.is_verified IS 'Whether the user is verified';
COMMENT ON COLUMN public.profiles.is_creator IS 'Whether the user is a creator';

-- Update existing profiles to have empty strings instead of NULL for new text fields
UPDATE public.profiles 
SET 
    wallet_address = COALESCE(wallet_address, ''),
    first_name = COALESCE(first_name, ''),
    last_name = COALESCE(last_name, ''),
    youtube = COALESCE(youtube, ''),
    x = COALESCE(x, ''),
    linkedin = COALESCE(linkedin, ''),
    thread = COALESCE(thread, ''),
    display_name = COALESCE(display_name, ''),
    email = COALESCE(email, ''),
    social_links = COALESCE(social_links, '{}'),
    preferences = COALESCE(preferences, '{}'),
    subscription_tier = COALESCE(subscription_tier, 'free'),
    subscription_status = COALESCE(subscription_status, 'inactive'),
    is_verified = COALESCE(is_verified, FALSE),
    is_creator = COALESCE(is_creator, FALSE)
WHERE 
    wallet_address IS NULL 
    OR first_name IS NULL 
    OR last_name IS NULL 
    OR youtube IS NULL 
    OR x IS NULL 
    OR linkedin IS NULL 
    OR thread IS NULL 
    OR display_name IS NULL 
    OR email IS NULL 
    OR social_links IS NULL 
    OR preferences IS NULL 
    OR subscription_tier IS NULL 
    OR subscription_status IS NULL 
    OR is_verified IS NULL 
    OR is_creator IS NULL;

-- Show the final table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND table_schema = 'public'
ORDER BY ordinal_position;
