-- Recent generations table for per-user persistence
create table if not exists public.recent_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  wallet_address text,
  type text not null check (type in ('image','video','gif')),
  url text not null,
  prompt text not null,
  model text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Index for fast listing
create index if not exists idx_recent_generations_user_created on public.recent_generations (user_id, created_at desc);

-- Enable RLS and add policies
alter table public.recent_generations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='recent_generations' and policyname='Users can manage their own generations'
  ) then
create policy "Users can manage their own generations" on public.recent_generations
  for all
  using ((auth.uid() = user_id) or (wallet_address is not null))
  with check ((auth.uid() = user_id) or (wallet_address is not null));
  end if;
end $$;

-- Comics Platform Database Setup

-- Enable RLS (Row Level Security)
ALTER DATABASE postgres SET "app.settings.flag_enable_rls" = 'on';

-- Create tables

-- Users table is automatically created by Supabase Auth

-- Comics table to store comic data
CREATE TABLE IF NOT EXISTS public.comics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    creator_wallet TEXT,
    cover_image TEXT,
    cover_type TEXT CHECK (cover_type IN ('image', 'video', 'gif')),
    content JSONB NOT NULL DEFAULT '{"pages": [], "pageTemplates": [], "narrations": {}}',
    is_published BOOLEAN DEFAULT FALSE,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    story_type TEXT CHECK (story_type IN ('ai_enhanced', 'traditional')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Comic templates
CREATE TABLE IF NOT EXISTS public.templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    layout JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Comic stats for analytics
CREATE TABLE IF NOT EXISTS public.comic_stats (
    comic_id TEXT PRIMARY KEY REFERENCES public.comics(id) ON DELETE CASCADE,
    view_count INTEGER DEFAULT 0,
    support_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Support/donations transactions
CREATE TABLE IF NOT EXISTS public.support_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    supporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    supporter_wallet TEXT,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    transaction_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Bookmarks for users to save comics
CREATE TABLE IF NOT EXISTS public.bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, comic_id)
);

-- Comments on comics
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    page_index INTEGER,
    panel_id TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Collaborators for comics
CREATE TABLE IF NOT EXISTS public.collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'idle', 'offline', 'online', 'away')),
    permissions JSONB DEFAULT '{"read": true, "write": true}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (comic_id, user_id)
);

-- Waitlist for platform access
CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    referral_code TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    approved_at TIMESTAMP WITH TIME ZONE
);

-- User profiles with additional information
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    wallet_address TEXT,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'premium')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'premium')),
    status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- AI Generation Credits
CREATE TABLE IF NOT EXISTS public.ai_credits (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    available_credits INTEGER NOT NULL DEFAULT 0,
    total_credits_used INTEGER NOT NULL DEFAULT 0,
    last_refill_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User wallets and authentication
CREATE TABLE IF NOT EXISTS public.user_auth_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('email', 'google', 'twitter', 'discord', 'wallet')),
    auth_provider_id TEXT,
    wallet_address TEXT,
    wallet_type TEXT CHECK (wallet_type IN ('solana', 'ethereum', 'phantom', 'metamask')),
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, auth_type, auth_provider_id),
    UNIQUE (wallet_address, wallet_type)
);

-- Enhanced user profiles with username tracking
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    email TEXT,
    wallet_address TEXT,
    social_links JSONB DEFAULT '{}',
    preferences JSONB DEFAULT '{}',
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'premium')),
    subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'trial', 'past_due', 'canceled')),
    subscription_expiry TIMESTAMP WITH TIME ZONE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_creator BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_]+$')
);

-- Username history for tracking changes
CREATE TABLE IF NOT EXISTS public.username_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    previous_username TEXT NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Payment transactions and subscriptions
CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method TEXT NOT NULL,
    payment_provider TEXT NOT NULL,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
    transaction_id TEXT UNIQUE,
    subscription_id TEXT REFERENCES public.subscriptions(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Subscription details
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id TEXT PRIMARY KEY, -- External provider subscription ID
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'premium')),
    status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Subscription plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    interval TEXT NOT NULL CHECK (interval IN ('monthly', 'yearly')),
    features JSONB DEFAULT '[]',
    ai_credits_per_period INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- AI Narration data
CREATE TABLE IF NOT EXISTS public.narrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    panel_id TEXT,
    text TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    audio_url TEXT,
    duration_seconds NUMERIC(10, 2),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- SAM3 Panel Embeddings for similarity search
CREATE TABLE IF NOT EXISTS public.panel_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    panel_id TEXT NOT NULL,
    comic_id UUID NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    embedding TEXT NOT NULL, -- Base64-encoded SAM3 embedding
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(panel_id, image_url) -- Prevent duplicate embeddings for same panel/URL
);

-- Indexes for fast embedding queries
CREATE INDEX IF NOT EXISTS idx_panel_embeddings_panel_id ON public.panel_embeddings(panel_id);
CREATE INDEX IF NOT EXISTS idx_panel_embeddings_comic_id ON public.panel_embeddings(comic_id);
CREATE INDEX IF NOT EXISTS idx_panel_embeddings_image_url ON public.panel_embeddings(image_url);

-- Enable RLS for panel embeddings
ALTER TABLE public.panel_embeddings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can manage embeddings for their own comics
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='panel_embeddings' AND policyname='Users can manage embeddings for their own comics'
  ) THEN
    CREATE POLICY "Users can manage embeddings for their own comics" ON public.panel_embeddings
      FOR ALL
      USING (
        comic_id IN (
          SELECT id FROM public.comics WHERE creator_id = auth.uid()
        )
      )
      WITH CHECK (
        comic_id IN (
          SELECT id FROM public.comics WHERE creator_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Voice options for narration
CREATE TABLE IF NOT EXISTS public.voice_options (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL, -- e.g., 'elevenlabs', 'openai', etc.
    name TEXT NOT NULL,
    gender TEXT,
    accent TEXT,
    description TEXT,
    preview_url TEXT,
    is_premium BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Comic sharing and social features
CREATE TABLE IF NOT EXISTS public.likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, comic_id)
);

-- Enhanced comments with reactions
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    page_index INTEGER,
    panel_id TEXT,
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
    reaction_count JSONB DEFAULT '{"like": 0, "love": 0, "haha": 0}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Comment reactions
CREATE TABLE IF NOT EXISTS public.comment_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK (reaction_type IN ('upvote', 'like', 'love', 'haha')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (comment_id, user_id, reaction_type)
);

-- Real-time collaboration session tracking
CREATE TABLE IF NOT EXISTS public.collaboration_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    started_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ended_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Collaboration presence and activity
CREATE TABLE IF NOT EXISTS public.collaboration_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'offline')),
    current_page INTEGER DEFAULT 0,
    cursor_position JSONB,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (session_id, user_id)
);

-- Collaboration change history
CREATE TABLE IF NOT EXISTS public.collaboration_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
    comic_id TEXT NOT NULL REFERENCES public.comics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    page_index INTEGER,
    panel_id TEXT,
    change_type TEXT NOT NULL CHECK (change_type IN ('add', 'update', 'delete', 'move')),
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- AI generation history and tracking
CREATE TABLE IF NOT EXISTS public.ai_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    comic_id TEXT REFERENCES public.comics(id) ON DELETE SET NULL,
    page_index INTEGER,
    panel_id TEXT,
    prompt TEXT NOT NULL,
    ai_service TEXT NOT NULL, -- e.g., 'dall-e', 'midjourney', 'stability', etc.
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
    result_url TEXT,
    metadata JSONB,
    credits_used INTEGER DEFAULT 1,
    processing_time NUMERIC(10, 2),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Share links for inviting trusted testers
CREATE TABLE IF NOT EXISTS public.share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comic_id TEXT REFERENCES public.comics(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    max_uses INTEGER DEFAULT 1,
    uses INTEGER DEFAULT 0,
    requires_signup BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '{"read": true, "comment": true, "edit": false}',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    full_url TEXT GENERATED ALWAYS AS (
        'https://hon-comic-creator.vercel.app/invite/' || token
    ) STORED,
    last_used_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT token_length CHECK (char_length(token) >= 6)
);

-- Track user activity for debugging and analytics
CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata JSONB,
    ip_address TEXT,
    user_agent TEXT,
    session_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Feature flags to control access to features for specific users or groups
CREATE TABLE IF NOT EXISTS public.feature_flags (
    name TEXT PRIMARY KEY,
    description TEXT,
    is_enabled BOOLEAN DEFAULT FALSE,
    user_ids UUID[] DEFAULT '{}',
    percentage_rollout INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Functions

-- Function to increment comic views
CREATE OR REPLACE FUNCTION increment_comic_views(input_comic_id TEXT)
RETURNS void AS $$
BEGIN
    INSERT INTO public.comic_stats (comic_id, view_count)
    VALUES (input_comic_id, 1)
    ON CONFLICT (comic_id)
    DO UPDATE SET 
        view_count = public.comic_stats.view_count + 1,
        last_updated = now();
END;
$$ LANGUAGE plpgsql;

-- Function to verify wallet signature for authentication
CREATE OR REPLACE FUNCTION verify_wallet_signature(p_wallet_address TEXT, p_signature TEXT, p_message TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- This is a placeholder. In a real implementation, this would verify
    -- a cryptographic signature from a wallet
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to link a wallet to a user account
CREATE OR REPLACE FUNCTION link_wallet_to_user(p_wallet_address TEXT, p_wallet_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Ensure user is authenticated
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated';
    END IF;
    
    -- Insert wallet auth method
    INSERT INTO public.user_auth_methods (
        user_id,
        auth_type,
        wallet_address,
        wallet_type,
        is_primary
    ) VALUES (
        v_user_id,
        'wallet',
        p_wallet_address,
        p_wallet_type,
        -- Make this primary if the user has no other auth methods
        NOT EXISTS (SELECT 1 FROM public.user_auth_methods WHERE user_id = v_user_id)
    );
    
    -- Update the user's profile with wallet address
    UPDATE public.profiles
    SET wallet_address = p_wallet_address,
        updated_at = now()
    WHERE id = v_user_id;
    
    RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Wallet already linked to another account';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to track user action (can be called client-side)
CREATE OR REPLACE FUNCTION track_user_action(p_action TEXT, p_resource_type TEXT, p_resource_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT NULL)
RETURNS void AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Insert activity record
    INSERT INTO public.user_activity (
        user_id,
        action,
        resource_type,
        resource_id,
        metadata,
        ip_address,
        user_agent,
        session_id
    ) VALUES (
        v_user_id,
        p_action,
        p_resource_type,
        p_resource_id,
        p_metadata,
        inet_client_addr()::TEXT,
        current_setting('request.headers', true)::json->>'user-agent',
        coalesce(current_setting('request.headers', true)::json->>'x-session-id', gen_random_uuid()::text)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update username with history tracking
CREATE OR REPLACE FUNCTION update_username(p_new_username TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_old_username TEXT;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Get current username
    SELECT username INTO v_old_username
    FROM public.profiles
    WHERE id = v_user_id;
    
    -- Check if username is changing
    IF v_old_username IS DISTINCT FROM p_new_username THEN
        -- Record old username in history
        IF v_old_username IS NOT NULL THEN
            INSERT INTO public.username_history (
                user_id,
                previous_username
            ) VALUES (
                v_user_id,
                v_old_username
            );
        END IF;
        
        -- Update username
        UPDATE public.profiles
        SET username = p_new_username,
            updated_at = now()
        WHERE id = v_user_id;
    END IF;
    
    RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Username already taken';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to consume AI credits for a generation
CREATE OR REPLACE FUNCTION consume_ai_credits(p_credits_amount INTEGER DEFAULT 1)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_credits INTEGER;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Get available credits
    SELECT available_credits INTO v_credits
    FROM public.ai_credits
    WHERE user_id = v_user_id;
    
    -- Check if enough credits
    IF v_credits IS NULL OR v_credits < p_credits_amount THEN
        RETURN FALSE;
    END IF;
    
    -- Update credits
    UPDATE public.ai_credits
    SET available_credits = available_credits - p_credits_amount,
        total_credits_used = total_credits_used + p_credits_amount
    WHERE user_id = v_user_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate and create a share link with permissions
CREATE OR REPLACE FUNCTION create_share_link(
    p_comic_id TEXT, 
    p_expires_in_days INTEGER DEFAULT 7,
    p_requires_signup BOOLEAN DEFAULT TRUE,
    p_permissions JSONB DEFAULT '{"read": true, "comment": true, "edit": false}'
)
RETURNS TEXT AS $$
DECLARE
    v_token TEXT;
    v_user_id UUID;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Generate a random token
    v_token := encode(gen_random_bytes(12), 'base64');
    v_token := replace(replace(replace(v_token, '/', '_'), '+', '-'), '=', '');
    
    -- Insert the share link
    INSERT INTO public.share_links (
        comic_id, 
        created_by, 
        token,
        requires_signup,
        permissions,
        expires_at
    ) VALUES (
        p_comic_id,
        v_user_id,
        v_token,
        p_requires_signup,
        p_permissions,
        CASE WHEN p_expires_in_days > 0 THEN 
            now() + (p_expires_in_days || ' days')::INTERVAL 
        ELSE 
            NULL 
        END
    );
    
    -- Return the token
    RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has access to a feature
CREATE OR REPLACE FUNCTION has_feature_access(p_feature_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_feature feature_flags;
    v_user_hash INTEGER;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Get feature flag
    SELECT * INTO v_feature FROM public.feature_flags WHERE name = p_feature_name;
    
    -- Feature doesn't exist or is not enabled
    IF v_feature IS NULL OR NOT v_feature.is_enabled THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user is explicitly granted access
    IF v_feature.user_ids IS NOT NULL AND v_user_id = ANY(v_feature.user_ids) THEN
        RETURN TRUE;
    END IF;
    
    -- Check percentage rollout (deterministic based on user ID)
    IF v_feature.percentage_rollout > 0 THEN
        -- Ensure consistent hashing for a user
        v_user_hash := (('x' || md5(v_user_id::text))::bit(32)::int % 100) + 1;
        RETURN v_user_hash <= v_feature.percentage_rollout;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments summary view for quick access to comment data with reactions
CREATE OR REPLACE VIEW public.comment_summaries AS
SELECT 
    c.id,
    c.comic_id,
    c.user_id,
    c.page_index,
    c.panel_id,
    c.content,
    c.is_edited,
    c.parent_id,
    c.created_at,
    c.updated_at,
    (
        SELECT COUNT(*) FROM public.comment_reactions 
        WHERE comment_id = c.id AND reaction_type = 'upvote'
    ) AS upvote_count,
    (
        SELECT COALESCE(jsonb_object_agg(reaction_type, reaction_count), '{}'::jsonb)
        FROM (
            SELECT reaction_type, COUNT(*) AS reaction_count
            FROM public.comment_reactions
            WHERE comment_id = c.id
            GROUP BY reaction_type
        ) r
    ) AS reaction_counts,
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', cr.id,
                'user_id', cr.user_id,
                'reaction_type', cr.reaction_type
            )
        )
        FROM public.comment_reactions cr
        WHERE cr.comment_id = c.id
    ) AS reactions
FROM public.comments c;

-- Function to upvote a comment (toggle upvote)
CREATE OR REPLACE FUNCTION toggle_comment_upvote(p_comment_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_exists BOOLEAN;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Check if user already upvoted
    SELECT EXISTS (
        SELECT 1 FROM public.comment_reactions 
        WHERE comment_id = p_comment_id 
        AND user_id = v_user_id
        AND reaction_type = 'upvote'
    ) INTO v_exists;
    
    -- Remove upvote if exists, add if doesn't
    IF v_exists THEN
        DELETE FROM public.comment_reactions
        WHERE comment_id = p_comment_id
        AND user_id = v_user_id
        AND reaction_type = 'upvote';
    ELSE
        INSERT INTO public.comment_reactions (
            comment_id,
            user_id,
            reaction_type
        ) VALUES (
            p_comment_id,
            v_user_id,
            'upvote'
        );
    END IF;
    
    RETURN NOT v_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate and create a shareable public link
CREATE OR REPLACE FUNCTION create_public_share_link(
    p_comic_id TEXT,
    p_expires_in_days INTEGER DEFAULT 30,
    p_max_uses INTEGER DEFAULT NULL,
    p_requires_signup BOOLEAN DEFAULT FALSE
)
RETURNS TEXT AS $$
DECLARE
    v_token TEXT;
    v_user_id UUID;
    v_full_url TEXT;
BEGIN
    -- Get current user ID
    v_user_id := auth.uid();
    
    -- Generate a random token
    v_token := encode(gen_random_bytes(8), 'base64');
    v_token := replace(replace(replace(v_token, '/', '_'), '+', '-'), '=', '');
    
    -- Insert the share link
    INSERT INTO public.share_links (
        comic_id, 
        created_by, 
        token,
        requires_signup,
        max_uses,
        permissions,
        expires_at
    ) VALUES (
        p_comic_id,
        v_user_id,
        v_token,
        p_requires_signup,
        p_max_uses,
        '{"read": true, "comment": true, "edit": false}',
        CASE WHEN p_expires_in_days > 0 THEN 
            now() + (p_expires_in_days || ' days')::INTERVAL 
        ELSE 
            NULL 
        END
    );
    
    -- Get the full URL
    SELECT full_url INTO v_full_url
    FROM public.share_links
    WHERE token = v_token;
    
    -- Return the full URL
    RETURN v_full_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Database policies for security

-- Comics policies
ALTER TABLE public.comics ENABLE ROW LEVEL SECURITY;

-- Allow users to read published comics
CREATE POLICY "Allow users to view published comics" 
    ON public.comics FOR SELECT 
    USING (is_published = true);

-- Allow creators to manage their own comics
CREATE POLICY "Allow creators to manage their comics" 
    ON public.comics FOR ALL 
    USING (creator_id = auth.uid());

-- Allow collaborators to view and edit comics they're collaborating on
CREATE POLICY "Allow collaborators to view and edit comics" 
    ON public.comics FOR ALL 
    USING (EXISTS (
        SELECT 1 FROM public.collaborators 
        WHERE comic_id = public.comics.id 
        AND user_id = auth.uid()
    ));

-- Other table policies
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view templates" ON public.templates FOR SELECT TO authenticated USING (true);

ALTER TABLE public.comic_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view comic stats" ON public.comic_stats FOR SELECT USING (true);
CREATE POLICY "Allow system to update comic stats" ON public.comic_stats FOR INSERT TO authenticated USING (true);
CREATE POLICY "Allow system to update comic stats" ON public.comic_stats FOR UPDATE TO authenticated USING (true);

ALTER TABLE public.support_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their support transactions" ON public.support_transactions FOR SELECT USING (supporter_id = auth.uid());
CREATE POLICY "Allow users to create support transactions" ON public.support_transactions FOR INSERT TO authenticated USING (supporter_id = auth.uid());

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to manage their bookmarks" ON public.bookmarks FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view comments" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Allow users to manage their comments" ON public.comments FOR ALL USING (user_id = auth.uid());

ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their collaborations" ON public.collaborators FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Allow comic owners to manage collaborators" ON public.collaborators FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.comics 
        WHERE id = public.collaborators.comic_id 
        AND creator_id = auth.uid()
    )
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Allow users to update their own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Allow users to insert their own profile" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their subscriptions" ON public.subscriptions FOR SELECT USING (user_id = auth.uid());

ALTER TABLE public.ai_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their AI credits" ON public.ai_credits FOR SELECT USING (user_id = auth.uid());

-- Security policies for new tables
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their share links" ON public.share_links FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "Users can create share links" ON public.share_links FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "Users can manage their share links" ON public.share_links FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "Users can delete their share links" ON public.share_links FOR DELETE USING (created_by = auth.uid());

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
-- Only allow users to view their own activity
CREATE POLICY "Users can view their activity" ON public.user_activity FOR SELECT USING (user_id = auth.uid());

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
-- Everyone can view feature flags
CREATE POLICY "All users can view feature flags" ON public.feature_flags FOR SELECT USING (true);

-- User profiles policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Allow users to update their own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Allow users to insert their own profile" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- User auth methods policies
ALTER TABLE public.user_auth_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their auth methods" ON public.user_auth_methods FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Allow users to manage their auth methods" ON public.user_auth_methods FOR ALL USING (user_id = auth.uid());

-- Username history policies
ALTER TABLE public.username_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their username history" ON public.username_history FOR SELECT USING (user_id = auth.uid());

-- Payment policies
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their payments" ON public.payment_transactions FOR SELECT USING (user_id = auth.uid());

-- Subscription policies
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their subscriptions" ON public.subscriptions FOR SELECT USING (user_id = auth.uid());

-- Subscription plans - viewable by all
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all to view subscription plans" ON public.subscription_plans FOR SELECT USING (true);

-- Narration policies
ALTER TABLE public.narrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view narrations on published comics" ON public.narrations FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.comics WHERE id = comic_id AND is_published = true));
CREATE POLICY "Allow creators to manage narrations" ON public.narrations FOR ALL 
    USING (created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM public.comics WHERE id = comic_id AND creator_id = auth.uid()
    ));
CREATE POLICY "Allow collaborators to manage narrations" ON public.narrations FOR ALL 
    USING (EXISTS (
        SELECT 1 FROM public.collaborators 
        WHERE comic_id = narrations.comic_id 
        AND user_id = auth.uid()
    ));

-- Voice options - viewable by all
ALTER TABLE public.voice_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all to view voice options" ON public.voice_options FOR SELECT USING (true);

-- Likes policies
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to manage their likes" ON public.likes FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Allow users to view likes on published comics" ON public.likes FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.comics WHERE id = comic_id AND is_published = true));

-- Comments policies 
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view comments on published comics" ON public.comments FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.comics WHERE id = comic_id AND is_published = true));
CREATE POLICY "Allow users to manage their comments" ON public.comments FOR ALL USING (user_id = auth.uid());

-- Comment reactions policies
ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to manage their reactions" ON public.comment_reactions FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Allow users to view all reactions" ON public.comment_reactions FOR SELECT USING (true);

-- Collaboration session policies
ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow comic owners to manage sessions" ON public.collaboration_sessions FOR ALL 
    USING (EXISTS (SELECT 1 FROM public.comics WHERE id = comic_id AND creator_id = auth.uid()));
CREATE POLICY "Allow collaborators to view sessions" ON public.collaboration_sessions FOR SELECT 
    USING (EXISTS (
        SELECT 1 FROM public.collaborators 
        WHERE comic_id = collaboration_sessions.comic_id 
        AND user_id = auth.uid()
    ));

-- Collaboration presence policies
ALTER TABLE public.collaboration_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow session participants to view presence" ON public.collaboration_presence FOR SELECT 
    USING (EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
        JOIN public.collaborators c ON cs.comic_id = c.comic_id
        WHERE cs.id = session_id AND c.user_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
        JOIN public.comics cm ON cs.comic_id = cm.id
        WHERE cs.id = session_id AND cm.creator_id = auth.uid()
    ));
CREATE POLICY "Allow users to manage their presence" ON public.collaboration_presence FOR ALL USING (user_id = auth.uid());

-- Collaboration changes policies
ALTER TABLE public.collaboration_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow session participants to view changes" ON public.collaboration_changes FOR SELECT 
    USING (EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
        JOIN public.collaborators c ON cs.comic_id = c.comic_id
        WHERE cs.id = session_id AND c.user_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
        JOIN public.comics cm ON cs.comic_id = cm.id
        WHERE cs.id = session_id AND cm.creator_id = auth.uid()
    ));

-- AI generations policies
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow users to view their AI generations" ON public.ai_generations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Allow users to manage their AI generations" ON public.ai_generations FOR ALL USING (user_id = auth.uid());

-- Share links policies
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their share links" ON public.share_links FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "Users can create share links" ON public.share_links FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "Users can manage their share links" ON public.share_links FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "Users can delete their share links" ON public.share_links FOR DELETE USING (created_by = auth.uid());

-- User activity policies
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their activity" ON public.user_activity FOR SELECT USING (user_id = auth.uid());

-- Feature flags policies
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All users can view feature flags" ON public.feature_flags FOR SELECT USING (true);

-- Initial data
INSERT INTO public.templates (id, name, description, icon, layout)
VALUES 
(
    'classic-strip', 
    'Classic Strip', 
    'A traditional 3-panel comic strip layout', 
    '📜', 
    '{"rows": 1, "cols": 3, "areas": [
        {"size": "medium", "position": {"row": 0, "col": 0}},
        {"size": "medium", "position": {"row": 0, "col": 1}},
        {"size": "medium", "position": {"row": 0, "col": 2}}
    ]}'
),
(
    'grid-layout', 
    'Grid Layout', 
    'A 3x3 grid layout for more complex stories', 
    '📏', 
    '{"rows": 3, "cols": 3, "areas": [
        {"size": "medium", "position": {"row": 0, "col": 0}},
        {"size": "medium", "position": {"row": 0, "col": 1}},
        {"size": "medium", "position": {"row": 0, "col": 2}},
        {"size": "medium", "position": {"row": 1, "col": 0}},
        {"size": "medium", "position": {"row": 1, "col": 1}},
        {"size": "medium", "position": {"row": 1, "col": 2}},
        {"size": "medium", "position": {"row": 2, "col": 0}},
        {"size": "medium", "position": {"row": 2, "col": 1}},
        {"size": "medium", "position": {"row": 2, "col": 2}}
    ]}'
),
(
    'featured-panel', 
    'Featured Panel', 
    'Layout with one large featured panel and supporting panels', 
    '🌟', 
    '{"rows": 2, "cols": 2, "areas": [
        {"size": "large", "position": {"row": 0, "col": 0, "rowSpan": 2, "colSpan": 1}},
        {"size": "medium", "position": {"row": 0, "col": 1}},
        {"size": "medium", "position": {"row": 1, "col": 1}}
    ]}'
);

-- Initial subscription plans
INSERT INTO public.subscription_plans (id, name, description, price, currency, interval, features, ai_credits_per_period, is_active)
VALUES 
('free-monthly', 'Free', 'Basic access to comic creation tools', 0, 'USD', 'monthly', '["basic_templates", "limited_panels", "image_upload"]', 10, true),
('pro-monthly', 'Pro', 'Enhanced comic creation with more AI features', 9.99, 'USD', 'monthly', '["all_templates", "unlimited_panels", "image_upload", "video_upload", "basic_ai_generation", "audio_narration"]', 100, true),
('premium-monthly', 'Premium', 'Full access to all features and priority AI generation', 19.99, 'USD', 'monthly', '["all_templates", "unlimited_panels", "image_upload", "video_upload", "premium_ai_generation", "audio_narration", "collaboration", "advanced_export"]', 500, true),
('pro-yearly', 'Pro (Yearly)', 'Enhanced comic creation with more AI features', 99.99, 'USD', 'yearly', '["all_templates", "unlimited_panels", "image_upload", "video_upload", "basic_ai_generation", "audio_narration"]', 1200, true),
('premium-yearly', 'Premium (Yearly)', 'Full access to all features and priority AI generation', 199.99, 'USD', 'yearly', '["all_templates", "unlimited_panels", "image_upload", "video_upload", "premium_ai_generation", "audio_narration", "collaboration", "advanced_export"]', 6000, true);

-- Initial voice options
INSERT INTO public.voice_options (id, provider, name, gender, accent, description, preview_url, is_premium, is_active)
VALUES 
('elevenlabs-en-us-male-1', 'elevenlabs', 'Adam', 'male', 'American', 'Deep clear male voice with American accent', NULL, true, true),
('elevenlabs-en-us-female-1', 'elevenlabs', 'Rachel', 'female', 'American', 'Warm female voice with American accent', NULL, true, true),
('elevenlabs-en-uk-male-1', 'elevenlabs', 'Thomas', 'male', 'British', 'Sophisticated male voice with British accent', NULL, true, true),
('elevenlabs-en-uk-female-1', 'elevenlabs', 'Emily', 'female', 'British', 'Clear female voice with British accent', NULL, true, true),
('free-en-us-male-1', 'system', 'Michael', 'male', 'American', 'Standard male voice', NULL, false, true),
('free-en-us-female-1', 'system', 'Sophia', 'female', 'American', 'Standard female voice', NULL, false, true);

-- Initial feature flags
INSERT INTO public.feature_flags (name, description, is_enabled)
VALUES 
('collaboration', 'Enable collaboration features', true),
('ai_generation', 'Enable AI generation features', true),
('audio_narration', 'Enable audio narration features', true),
('video_panels', 'Enable video panels in comics', true),
('export', 'Enable comic export functionality', true),
('sharing', 'Enable comic sharing functionality', true),
('wallet_integration', 'Enable wallet connection', true),
('social_login', 'Enable social login options', true),
('subscriptions', 'Enable subscription features', true),
('realtime_comments', 'Enable real-time comments', true); 