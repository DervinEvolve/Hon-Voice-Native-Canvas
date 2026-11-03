-- Additional RLS Policy for Wallet-Only Authentication
-- Run this in your Supabase SQL Editor

-- Allow wallet-only profile creation (when user is not authenticated via email/social)
CREATE POLICY "Allow wallet-only profile creation" ON public.profiles 
FOR INSERT 
WITH CHECK (
  -- Allow if user is authenticated AND it's their profile
  (auth.uid() IS NOT NULL AND id = auth.uid()) 
  OR 
  -- Allow wallet-only profiles (no auth.uid() but has wallet_id and solana_wallet)
  (auth.uid() IS NULL AND wallet_id IS NOT NULL AND solana_wallet IS NOT NULL AND id IS NULL)
);

-- Update the existing insert policy to be more specific
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.profiles;

-- Allow wallet-only profile updates (they can update their own wallet profile)
CREATE POLICY "Allow wallet-only profile updates" ON public.profiles 
FOR UPDATE 
USING (
  -- Users can update their own authenticated profile
  (auth.uid() IS NOT NULL AND id = auth.uid())
  OR
  -- Allow updates to wallet profiles (this would need additional session management)
  (wallet_id IS NOT NULL AND solana_wallet IS NOT NULL)
);

-- Update the existing update policy
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles; 