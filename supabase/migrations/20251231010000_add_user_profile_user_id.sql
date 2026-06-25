-- Adds user_id column to user_profiles (id is PK, but user_id needed for FKs)
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS user_id UUID;
