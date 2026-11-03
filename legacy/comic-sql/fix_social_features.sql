-- Refresh the schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- Create necessary tables if they don't exist
-- 1. Create comic_comments table
CREATE TABLE IF NOT EXISTS public.comic_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comic_id TEXT NOT NULL,
    user_id UUID NOT NULL,
    content TEXT NOT NULL,
    parent_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Create bookmarks table
CREATE TABLE IF NOT EXISTS public.bookmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    comic_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, comic_id)
);

-- 3. Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID NOT NULL,
    creator_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(subscriber_id, creator_id)
);

-- 4. Create comics table if it doesn't exist (for joins)
CREATE TABLE IF NOT EXISTS public.comics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    creator_id TEXT,
    creator_wallet TEXT,
    cover_image TEXT,
    cover_type TEXT,
    content JSONB,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 1. Fix the get_comic_comments function to accept p_comic_draft_id
DROP FUNCTION IF EXISTS public.get_comic_comments(TEXT);
CREATE OR REPLACE FUNCTION public.get_comic_comments(p_comic_draft_id TEXT)
RETURNS TABLE (
    id UUID,
    comic_id TEXT,
    user_id UUID,
    content TEXT,
    parent_id UUID,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    username TEXT,
    avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cc.id,
        cc.comic_id,
        cc.user_id,
        cc.content,
        cc.parent_id,
        cc.created_at,
        cc.updated_at,
        p.username,
        p.avatar_url
    FROM public.comic_comments cc
    LEFT JOIN public.profiles p ON cc.user_id = p.id
    WHERE cc.comic_id = p_comic_draft_id
    ORDER BY cc.created_at ASC;
END;
$$;

-- 2. Fix the add_comment function to match client expectations
DROP FUNCTION IF EXISTS public.add_comment(TEXT, TEXT, UUID, UUID);
CREATE OR REPLACE FUNCTION public.add_comment(
    p_creator_identifier TEXT,
    p_content TEXT,
    p_parent_id UUID DEFAULT NULL,
    p_user_identifier UUID DEFAULT auth.uid()
)
RETURNS TABLE (
    id UUID,
    comic_id TEXT,
    user_id UUID,
    content TEXT,
    parent_id UUID,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    username TEXT,
    avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_comment_id UUID;
BEGIN
    -- Check if the user exists
    IF p_user_identifier IS NULL THEN
        p_user_identifier := auth.uid();
    END IF;
    
    IF p_user_identifier IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;
    
    -- Insert the comment
    INSERT INTO public.comic_comments (
        comic_id,
        user_id,
        content,
        parent_id
    )
    VALUES (
        p_creator_identifier,
        p_user_identifier,
        p_content,
        p_parent_id
    )
    RETURNING id INTO v_comment_id;
    
    -- Return the newly created comment with profile info
    RETURN QUERY
    SELECT 
        cc.id,
        cc.comic_id,
        cc.user_id,
        cc.content,
        cc.parent_id,
        cc.created_at,
        cc.updated_at,
        p.username,
        p.avatar_url
    FROM public.comic_comments cc
    LEFT JOIN public.profiles p ON cc.user_id = p.id
    WHERE cc.id = v_comment_id;
END;
$$;

-- 3. Create a profile for the creator wallet if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE solana_wallet = 'DTfS2QwBkXZKVMUmJ2eZo3d1enk7hyAcxfQGq4HNRZkp') THEN
        INSERT INTO public.profiles (id, username, solana_wallet, wallet_connected, auth_method, is_creator, notification_preferences)
        VALUES (
            uuid_generate_v4(),
            'Anonymous Creator',
            'DTfS2QwBkXZKVMUmJ2eZo3d1enk7hyAcxfQGq4HNRZkp',
            true,
            'wallet',
            true,
            '{"support_received": true, "new_stories": true}'
        );
    END IF;
END $$;

-- 4. Fix the toggle_subscription function to handle wallet addresses better
DROP FUNCTION IF EXISTS public.toggle_subscription(UUID, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.toggle_subscription(
    p_subscriber_identifier UUID DEFAULT auth.uid(),
    p_creator_identifier TEXT DEFAULT NULL,
    p_is_subscribed BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_state BOOLEAN;
    v_new_state BOOLEAN;
    v_creator_uuid UUID;
BEGIN
    -- Default to current user if not provided
    IF p_subscriber_identifier IS NULL THEN
        p_subscriber_identifier := auth.uid();
    END IF;
    
    -- Require creator_id
    IF p_creator_identifier IS NULL THEN
        RAISE EXCEPTION 'Creator ID is required';
    END IF;
    
    -- Try to find the creator by solana wallet
    SELECT id INTO v_creator_uuid
    FROM public.profiles
    WHERE solana_wallet = p_creator_identifier;
    
    -- If not found, create a temporary profile
    IF v_creator_uuid IS NULL THEN
        INSERT INTO public.profiles (id, username, solana_wallet, wallet_connected, auth_method, is_creator, notification_preferences)
        VALUES (
            uuid_generate_v4(),
            'Anonymous Creator',
            p_creator_identifier,
            true,
            'wallet',
            true,
            '{"support_received": true, "new_stories": true}'
        )
        RETURNING id INTO v_creator_uuid;
    END IF;
    
    -- Check current state
    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE subscriber_id = p_subscriber_identifier
        AND creator_id = v_creator_uuid
    ) INTO v_current_state;
    
    -- Determine new state
    IF p_is_subscribed IS NULL THEN
        v_new_state := NOT v_current_state;
    ELSE
        v_new_state := p_is_subscribed;
    END IF;
    
    -- Apply change if needed
    IF v_current_state <> v_new_state THEN
        IF v_new_state THEN
            -- Add subscription
            INSERT INTO public.subscriptions (subscriber_id, creator_id)
            VALUES (p_subscriber_identifier, v_creator_uuid)
            ON CONFLICT (subscriber_id, creator_id) DO NOTHING;
        ELSE
            -- Remove subscription
            DELETE FROM public.subscriptions
            WHERE subscriber_id = p_subscriber_identifier
            AND creator_id = v_creator_uuid;
        END IF;
    END IF;
    
    RETURN v_new_state;
END;
$$;

-- 5. Fix the toggle_bookmark function to handle wallet addresses better
DROP FUNCTION IF EXISTS public.toggle_bookmark(TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.toggle_bookmark(
    p_user_identifier TEXT DEFAULT auth.uid()::text,
    p_comic_identifier TEXT DEFAULT NULL,
    p_is_bookmarked BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_state BOOLEAN;
    v_new_state BOOLEAN;
    v_user_id TEXT;
BEGIN
    -- Default to current user if not provided
    IF p_user_identifier IS NULL THEN
        v_user_id := auth.uid()::text;
    ELSE
        v_user_id := p_user_identifier;
    END IF;
    
    -- Require comic_id
    IF p_comic_identifier IS NULL THEN
        RAISE EXCEPTION 'Comic ID is required';
    END IF;
    
    -- Check current state
    SELECT EXISTS (
        SELECT 1
        FROM public.bookmarks
        WHERE user_id = v_user_id
        AND comic_id = p_comic_identifier
    ) INTO v_current_state;
    
    -- Determine new state
    IF p_is_bookmarked IS NULL THEN
        v_new_state := NOT v_current_state;
    ELSE
        v_new_state := p_is_bookmarked;
    END IF;
    
    -- Apply change if needed
    IF v_current_state <> v_new_state THEN
        IF v_new_state THEN
            -- Add bookmark
            INSERT INTO public.bookmarks (user_id, comic_id)
            VALUES (v_user_id, p_comic_identifier)
            ON CONFLICT (user_id, comic_id) DO NOTHING;
        ELSE
            -- Remove bookmark
            DELETE FROM public.bookmarks
            WHERE user_id = v_user_id
            AND comic_id = p_comic_identifier;
        END IF;
    END IF;
    
    RETURN json_build_object('is_bookmarked', v_new_state);
END;
$$;

-- 6. Create the is_comic_bookmarked function
DROP FUNCTION IF EXISTS public.is_comic_bookmarked(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.is_comic_bookmarked(
    p_comic_identifier TEXT,
    p_user_identifier TEXT DEFAULT auth.uid()::text
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_bookmarked BOOLEAN;
BEGIN
    -- Check if the comic is bookmarked
    SELECT EXISTS (
        SELECT 1
        FROM public.bookmarks
        WHERE user_id = p_user_identifier
        AND comic_id = p_comic_identifier
    ) INTO v_is_bookmarked;
    
    RETURN json_build_object('is_bookmarked', v_is_bookmarked);
END;
$$;

-- 7. Create the get_user_bookmarks function
DROP FUNCTION IF EXISTS public.get_user_bookmarks();
CREATE OR REPLACE FUNCTION public.get_user_bookmarks()
RETURNS TABLE (
    id UUID,
    comics JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        jsonb_build_object(
            'id', c.id,
            'title', c.title,
            'creator_id', c.creator_id,
            'creator_wallet', c.creator_wallet,
            'cover_image', c.cover_image,
            'cover_type', c.cover_type,
            'is_published', c.is_published,
            'created_at', c.created_at,
            'updated_at', c.updated_at
        ) AS comics
    FROM public.bookmarks b
    LEFT JOIN public.comics c ON b.comic_id = c.id
    WHERE b.user_id = auth.uid()::text
    ORDER BY b.created_at DESC;
END;
$$;

-- 8. Create the get_user_subscriptions function
DROP FUNCTION IF EXISTS public.get_user_subscriptions(TEXT);
CREATE OR REPLACE FUNCTION public.get_user_subscriptions(
    p_subscriber_wallet TEXT DEFAULT auth.uid()::text
)
RETURNS TABLE (
    id UUID,
    creator JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        jsonb_build_object(
            'id', p.id,
            'username', p.username,
            'avatar_url', p.avatar_url,
            'social_links', jsonb_build_object(
                'twitter', p.twitter_url,
                'instagram', p.instagram_url,
                'website', p.website_url
            )
        ) AS creator
    FROM public.subscriptions s
    LEFT JOIN public.profiles p ON s.creator_id = p.id
    WHERE s.subscriber_id = p_subscriber_wallet::uuid
    ORDER BY s.created_at DESC;
END;
$$;

-- Set up RLS policies to allow anonymous access
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookmarks_select_policy ON public.bookmarks;
CREATE POLICY bookmarks_select_policy ON public.bookmarks FOR SELECT USING (true);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_select_policy ON public.subscriptions;
CREATE POLICY subscriptions_select_policy ON public.subscriptions FOR SELECT USING (true);

ALTER TABLE public.comic_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comic_comments_select_policy ON public.comic_comments;
CREATE POLICY comic_comments_select_policy ON public.comic_comments FOR SELECT USING (true);

-- Refresh the schema cache
SELECT pg_notify('pgrst', 'reload schema');
