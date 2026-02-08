-- =====================================================
-- PEDICAB APP - DATA CLEANUP SCRIPT (COMPLETE)
-- =====================================================
-- This script deletes ALL user data in the correct order
-- to avoid foreign key constraint errors
-- =====================================================

-- IMPORTANT: This will delete ALL data. Make sure you want to do this!

-- 1. Delete declined_rides first (has foreign key to rides)
DELETE FROM declined_rides;

-- 2. Delete messages (has foreign key to rides)
DELETE FROM messages;

-- 3. Delete all rides
DELETE FROM rides;

-- 4. Delete all drivers
DELETE FROM drivers;

-- 5. Delete all users from the public users table
DELETE FROM users;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these to verify all data is deleted:

SELECT COUNT(*) as declined_rides_count FROM declined_rides;
SELECT COUNT(*) as messages_count FROM messages;
SELECT COUNT(*) as rides_count FROM rides;
SELECT COUNT(*) as drivers_count FROM drivers;
SELECT COUNT(*) as users_count FROM users;

-- =====================================================
-- NOTE: After running this script, you'll also need to:
-- 1. Go to Supabase Dashboard > Authentication > Users
-- 2. Manually delete all users from the Auth system
-- =====================================================
