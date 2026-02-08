-- 1. THE USERS TABLE (Linked to Supabase Auth)
CREATE TABLE users (
    id UUID PRIMARY KEY, -- Matches auth.users id
    fullname VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20),
    role VARCHAR(20), -- 'passenger', 'driver', or 'tmo'
    avatar_url TEXT,
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    preferred_color TEXT DEFAULT '#f4f7fe',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. THE DRIVERS TABLE (Extra info just for the drivers)
CREATE TABLE drivers (
    driver_id UUID PRIMARY KEY REFERENCES users(id),
    pedicab_plate VARCHAR(20),
    status VARCHAR(20) DEFAULT 'offline',
    total_earnings DECIMAL(10, 2) DEFAULT 0.00,
    last_status_change TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    verification_status VARCHAR(20) DEFAULT 'pending',
    tmo_permit_no VARCHAR(50),
    registration_group VARCHAR(100),
    last_inspection DATE
);

-- 3. THE RIDES TABLE (The history of every trip)
CREATE TABLE rides (
    ride_id SERIAL PRIMARY KEY,
    passenger_id UUID REFERENCES users(id),
    driver_id UUID REFERENCES users(id),
    pickup_location VARCHAR(255),
    dropoff_location VARCHAR(255),
    price DECIMAL(10, 2),
    status VARCHAR(20), -- 'pending', 'accepted', 'completed', 'cancelled'
    request_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    rating INT,
    review_text TEXT
);

-- 4. THE EMERGENCIES TABLE
CREATE TABLE emergencies (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    ride_id INT REFERENCES rides(ride_id),
    type VARCHAR(50) DEFAULT 'Panic Button',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    location_lat DECIMAL,
    location_lng DECIMAL
);

-- 5. THE SYSTEM ALERTS TABLE (For TMO Broadcasts)
CREATE TABLE system_alerts (
    id SERIAL PRIMARY KEY,
    tmo_id UUID REFERENCES users(id),
    title VARCHAR(255),
    message TEXT,
    type VARCHAR(20) DEFAULT 'info', -- 'info', 'warning', 'danger'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. THE MESSAGES TABLE (For In-App Chat)
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    ride_id INT REFERENCES rides(ride_id),
    sender_id UUID REFERENCES users(id),
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
-- 7. THE DECLINED RIDES TABLE
CREATE TABLE declined_rides (
    id SERIAL PRIMARY KEY,
    driver_id UUID REFERENCES users(id),
    ride_id INT REFERENCES rides(ride_id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(driver_id, ride_id)
);

-- 8. ENABLE REALTIME FOR CRITICAL TABLES
-- This allows real-time subscriptions for SOS alerts and ride updates
ALTER PUBLICATION supabase_realtime ADD TABLE emergencies;
ALTER PUBLICATION supabase_realtime ADD TABLE rides;
ALTER PUBLICATION supabase_realtime ADD TABLE system_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE drivers;

-- 9. ADD GPS LOCATION TRACKING COLUMNS
-- For real-time driver tracking
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lat DECIMAL(10, 8);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lng DECIMAL(11, 8);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;

-- For storing pickup/dropoff coordinates
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lat DECIMAL(10, 8);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_lng DECIMAL(11, 8);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS dropoff_lat DECIMAL(10, 8);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS dropoff_lng DECIMAL(11, 8);
