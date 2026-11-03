-- Check current profiles table schema
-- Run this to see what columns actually exist

-- Get column information for profiles table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if specific columns exist
SELECT 
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'first_name'
    ) THEN 'first_name EXISTS' ELSE 'first_name MISSING' END as first_name_status,
    
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'last_name'
    ) THEN 'last_name EXISTS' ELSE 'last_name MISSING' END as last_name_status,
    
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'youtube'
    ) THEN 'youtube EXISTS' ELSE 'youtube MISSING' END as youtube_status,
    
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'x'
    ) THEN 'x EXISTS' ELSE 'x MISSING' END as x_status,
    
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'linkedin'
    ) THEN 'linkedin EXISTS' ELSE 'linkedin MISSING' END as linkedin_status,
    
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'thread'
    ) THEN 'thread EXISTS' ELSE 'thread MISSING' END as thread_status;
