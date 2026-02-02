
import { supabaseClient } from './config.js';
import { playNotificationSound } from './audio.js';

let lastSeenId = 0;
let currentStatus = 'offline';

export function setRideServiceStatus(status) {
    console.log('RideService: Status changed to', status);
    currentStatus = status;
}

export async function setupRideListener(driverId, onNewRide) {
    // 1. Initialize lastSeenId to the NEWEST ride currently in the DB
    // This ensures we only play sounds for rides created AFTER the listener starts
    try {
        const { data } = await supabaseClient
            .from('rides')
            .select('ride_id')
            .eq('status', 'pending')
            .order('ride_id', { ascending: false })
            .limit(1);
        if (data && data.length > 0) {
            lastSeenId = data[0].ride_id;
        }
    } catch (e) { console.warn('Sound initialization skipped'); }

    // 2. Setup Realtime
    const rideChannel = supabaseClient.channel(`driver-rides-${driverId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            table: 'rides',
            filter: 'status=eq.pending'
        }, payload => {
            console.log('RideService: New pending ride received', payload.new.ride_id);
            // Only play if we are online and it's a new ID
            if (currentStatus === 'online') {
                playNotificationSound();
            }
            lastSeenId = payload.new.ride_id;
            if (onNewRide) onNewRide();
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            table: 'rides'
        }, payload => {
            if (onNewRide) onNewRide();
        })
        .subscribe();

    setInterval(async () => {
        if (currentStatus === 'online') {
            try {
                const { data } = await supabaseClient
                    .from('rides')
                    .select('ride_id')
                    .eq('status', 'pending')
                    .order('ride_id', { ascending: false })
                    .limit(1);

                if (data && data.length > 0) {
                    const newestId = data[0].ride_id;
                    if (newestId > lastSeenId) {
                        playNotificationSound();
                        lastSeenId = newestId;
                        if (onNewRide) onNewRide();
                    }
                }
            } catch (e) { console.error('Heartbeat Error'); }
        }
    }, 10000);
}

export async function fetchPendingRides(driverId) {
    try {
        // 1. Get declined rides IDs
        let declinedIds = [];
        try {
            const { data: dData } = await supabaseClient
                .from('declined_rides')
                .select('ride_id')
                .eq('driver_id', driverId);
            if (dData) declinedIds = dData.map(d => String(d.ride_id));
        } catch (e) { /* ignore */ }

        // 2. Fetch the rides directly (No Join - this prevents the "Relationship" error)
        const { data: rides, error } = await supabaseClient
            .from('rides')
            .select('*')
            .eq('status', 'pending')
            .order('request_time', { ascending: false });

        if (error) throw error;
        if (!rides || rides.length === 0) return [];

        // 3. Filter out declined
        const filteredRides = rides.filter(r => !declinedIds.includes(String(r.ride_id)));
        if (filteredRides.length === 0) return [];

        // 4. Manually fetch the User names for these rides (Bulletproof method)
        const passengerIds = [...new Set(filteredRides.map(r => r.passenger_id))];
        const { data: userData } = await supabaseClient
            .from('users')
            .select('id, fullname, avatar_url')
            .in('id', passengerIds);

        // 5. Attach the user data to each ride
        const userMap = {};
        if (userData) {
            userData.forEach(u => userMap[u.id] = u);
        }

        return filteredRides.map(ride => ({
            ...ride,
            passenger: userMap[ride.passenger_id] || { fullname: 'Passenger' }
        }));

    } catch (err) {
        console.error('RideService: Fatal fetch error', err);
        return [];
    }
}

export async function fetchActiveRide(driverId) {
    const { data: activeRide } = await supabaseClient
        .from('rides')
        .select('*')
        .eq('driver_id', driverId)
        .eq('status', 'accepted')
        .maybeSingle();
    return activeRide;
}

export async function acceptRide(rideId, driverId) {
    const { error } = await supabaseClient
        .from('rides')
        .update({ status: 'accepted', driver_id: driverId })
        .eq('ride_id', rideId);
    if (error) throw error;
    return true;
}

export async function declineRide(rideId, driverId) {
    const { error } = await supabaseClient
        .from('declined_rides')
        .insert([{ driver_id: driverId, ride_id: rideId }]);
    return true;
}

export async function completeTrip(rideId, price) {
    const { error } = await supabaseClient
        .from('rides')
        .update({ status: 'completed', price })
        .eq('ride_id', rideId);
    return true;
}

export async function fetchChatMessages(rideId) {
    const { data } = await supabaseClient.from('messages').select('*').eq('ride_id', rideId).order('created_at', { ascending: true });
    return data || [];
}

export async function sendChatMessage(rideId, senderId, content) {
    await supabaseClient.from('messages').insert([{ ride_id: rideId, sender_id: senderId, content }]);
    return true;
}
