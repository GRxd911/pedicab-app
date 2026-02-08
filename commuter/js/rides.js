
import { supabaseClient } from '../../shared/js/config/config.js';

export async function fetchActiveRide(userId) {
    const { data: activePath, error } = await supabaseClient
        .from('rides')
        .select('*')
        .eq('passenger_id', userId)
        .in('status', ['pending', 'accepted', 'on-trip'])
        .order('request_time', { ascending: false })
        .limit(1);

    if (error) throw error;
    return activePath && activePath.length > 0 ? activePath[0] : null;
}

export async function fetchLastCompletedRide(userId) {
    const { data: completedRide, error } = await supabaseClient
        .from('rides')
        .select('*')
        .eq('passenger_id', userId)
        .eq('status', 'completed')
        .order('request_time', { ascending: false })
        .limit(1);

    if (error) throw error;
    return completedRide && completedRide.length > 0 ? completedRide[0] : null;
}

export async function requestRide(userId, pickup, dropoff, pickupCoords = null, dropoffCoords = null) {
    // Check if user already has an active ride
    const { data: active } = await supabaseClient
        .from('rides')
        .select('ride_id')
        .eq('passenger_id', userId)
        .in('status', ['pending', 'accepted', 'on-trip']);

    if (active && active.length > 0) {
        throw new Error('You already have an active request or trip!');
    }

    const { data: insertedRide, error } = await supabaseClient
        .from('rides')
        .insert([{
            passenger_id: userId,
            pickup_location: pickup,
            dropoff_location: dropoff,
            pickup_lat: pickupCoords?.lat,
            pickup_lng: pickupCoords?.lng,
            dropoff_lat: dropoffCoords?.lat,
            dropoff_lng: dropoffCoords?.lng,
            price: 0,
            status: 'pending'
        }])
        .select();

    if (error) throw error;
    return insertedRide[0];
}

export async function cancelRide(rideId) {
    const { error } = await supabaseClient
        .from('rides')
        .update({ status: 'cancelled' })
        .eq('ride_id', rideId);
    if (error) throw error;
    return true;
}

export async function cancelAllPendingRides(userId) {
    // Check if there are any rides that are already accepted or on-trip
    const { data: activeRides } = await supabaseClient
        .from('rides')
        .select('status')
        .eq('passenger_id', userId)
        .in('status', ['accepted', 'on-trip']);

    if (activeRides && activeRides.length > 0) {
        throw new Error("You cannot reset your ride because a driver has already accepted or the trip is in progress.");
    }

    const { error } = await supabaseClient.from('rides')
        .update({ status: 'cancelled' })
        .eq('passenger_id', userId)
        .eq('status', 'pending');

    if (error) throw error;
    return true;
}

export async function fetchAvailableDrivers() {
    const { data: drivers, error } = await supabaseClient
        .from('drivers')
        .select(`
            *,
            users (fullname, avatar_url)
        `)
        .eq('status', 'online')
        .eq('verification_status', 'verified');

    if (error) throw error;
    return drivers;
}

export async function fetchTripHistory(userId, limit = 5) {
    const { data: trips, error } = await supabaseClient
        .from('rides')
        .select(`
            *,
            users:driver_id (fullname, avatar_url)
        `)
        .eq('passenger_id', userId)
        .eq('status', 'completed')
        .order('request_time', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return trips;
}

export async function saveRating(rideId, rating, feedback) {
    const { error } = await supabaseClient
        .from('rides')
        .update({
            rating: rating,
            review_text: feedback
        })
        .eq('ride_id', rideId);
    if (error) throw error;
    return true;
}

export async function createEmergencySOS(userId, rideId, lat, lng) {
    const { data, error } = await supabaseClient
        .from('emergencies')
        .insert([{
            user_id: userId,
            ride_id: rideId || null,
            type: rideId ? 'Passenger SOS' : 'General SOS',
            status: 'active',
            location_lat: lat,
            location_lng: lng
        }])
        .select();

    if (error) throw error;
    return data[0];
}

export async function fetchSuggestions(userId) {
    const { data, error } = await supabaseClient
        .from('rides')
        .select('pickup_location, dropoff_location')
        .eq('passenger_id', userId)
        .eq('status', 'completed')
        .limit(20);

    if (error) return [];

    const routes = data.map(r => `${r.pickup_location} → ${r.dropoff_location}`);
    const counts = {};
    routes.forEach(r => counts[r] = (counts[r] || 0) + 1);

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);
}

export async function fetchDriverDetails(driverId) {
    const { data: userData } = await supabaseClient
        .from('users')
        .select('fullname, phone, avatar_url')
        .eq('id', driverId)
        .single();

    const { data: driverData } = await supabaseClient
        .from('drivers')
        .select('pedicab_plate, registration_group')
        .eq('driver_id', driverId)
        .single();

    return { ...userData, ...driverData };
}
