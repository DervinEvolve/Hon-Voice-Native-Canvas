-- Migration to add missing profile fields
-- Run this SQL to update your existing profiles table

-- Add missing columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT,
ADD COLUMN IF NOT EXISTS youtube TEXT,
ADD COLUMN IF NOT EXISTS x TEXT,
ADD COLUMN IF NOT EXISTS linkedin TEXT,
ADD COLUMN IF NOT EXISTS thread TEXT,
ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.first_name IS 'User first name';
COMMENT ON COLUMN public.profiles.last_name IS 'User last name';
COMMENT ON COLUMN public.profiles.youtube IS 'YouTube channel URL';
COMMENT ON COLUMN public.profiles.x IS 'X (Twitter) profile URL';
COMMENT ON COLUMN public.profiles.linkedin IS 'LinkedIn profile URL';
COMMENT ON COLUMN public.profiles.thread IS 'Thread profile URL';
COMMENT ON COLUMN public.profiles.banner_url IS 'Profile banner image URL';

-- Update existing profiles to have empty strings instead of NULL for new fields
UPDATE public.profiles 
SET 
    first_name = COALESCE(first_name, ''),
    last_name = COALESCE(last_name, ''),
    youtube = COALESCE(youtube, ''),
    x = COALESCE(x, ''),
    linkedin = COALESCE(linkedin, ''),
    thread = COALESCE(thread, ''),
    banner_url = COALESCE(banner_url, '')
WHERE 
    first_name IS NULL 
    OR last_name IS NULL 
    OR youtube IS NULL 
    OR x IS NULL 
    OR linkedin IS NULL 
    OR thread IS NULL 
    OR banner_url IS NULL;
