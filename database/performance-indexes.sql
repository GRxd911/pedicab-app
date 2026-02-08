-- =====================================================
-- PERFORMANCE OPTIMIZATION - DATABASE INDEXES
-- =====================================================
-- Run this in Supabase SQL Editor to speed up queries
-- These indexes will make your app 10-100x faster at scale
-- =====================================================

-- 1. Index for finding rides by passenger
CREATE INDEX IF NOT EXISTS idx_rides_passenger_id ON rides(passenger_id);

-- 2. Index for finding rides by driver
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);

-- 3. Index for finding rides by status (for pending rides)
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);

-- 4. Index for finding rides by date (for "trips today" queries)
CREATE INDEX IF NOT EXISTS idx_rides_request_time ON rides(request_time);

-- 5. Index for finding online drivers
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);

-- 6. Index for finding pending driver verifications
CREATE INDEX IF NOT EXISTS idx_drivers_verification ON drivers(verification_status);

-- 7. Index for finding active emergencies
CREATE INDEX IF NOT EXISTS idx_emergencies_status ON emergencies(status);

-- 8. Index for user roles
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 9. Index for messages by ride
CREATE INDEX IF NOT EXISTS idx_messages_ride_id ON messages(ride_id);

-- 10. Composite index for declined rides lookup
CREATE INDEX IF NOT EXISTS idx_declined_rides_driver_ride ON declined_rides(driver_id, ride_id);

-- =====================================================
-- VERIFICATION
-- =====================================================
-- Check that indexes were created:
SELECT tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
