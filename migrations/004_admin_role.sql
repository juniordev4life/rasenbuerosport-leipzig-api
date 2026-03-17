-- Migration 004: Add role column to profiles for admin access control

ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Set marco.slusalek@googlemail.com as admin
-- Firebase Auth UID must be used; update via app after login if needed
-- For now, this can be set manually:
-- UPDATE profiles SET role = 'admin' WHERE id = '<firebase-uid>';
