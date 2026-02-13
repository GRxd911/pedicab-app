
import { supabaseClient } from '../../shared/js/config/config.js';

export async function getDashboardStats() {
    // 1. Registered Passengers
    const { count: userCount } = await supabaseClient
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'passenger');

    // 2. Trips Today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: tripsCount } = await supabaseClient
        .from('rides')
        .select('*', { count: 'exact', head: true })
        .gte('request_time', todayStart.toISOString());

    // 3. Active Emergencies
    const { count: emergencyCount } = await supabaseClient
        .from('emergencies')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

    // 4. Pending Verifications
    const { count: pendingCount } = await supabaseClient
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .or('verification_status.eq.pending,verification_status.is.null');

    // 5. Active Drivers
    const { data: activeDrivers } = await supabaseClient
        .from('drivers')
        .select(`
            *,
            users (fullname)
        `)
        .eq('status', 'online');

    return {
        userCount: userCount || 0,
        tripsCount: tripsCount || 0,
        emergencyCount: emergencyCount || 0,
        pendingCount: pendingCount || 0,
        activeDrivers: activeDrivers || []
    };
}

export async function getDrivers(filter = 'all') {
    let query = supabaseClient
        .from('drivers')
        .select(`
            *,
            users (fullname, phone, email, avatar_url)
        `);

    if (filter === 'pending') {
        query = query.or('verification_status.eq.pending,verification_status.is.null');
    } else if (filter === 'verified') {
        query = query.eq('verification_status', 'verified');
    }

    // Order by last status change or some existing column
    query = query.order('last_status_change', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function getUsers() {
    const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

export async function verifyDriver(driverId, permit, zone, inspectionDate, tmoId) {
    const { error } = await supabaseClient
        .from('drivers')
        .update({
            verification_status: 'verified',
            tmo_permit_no: permit,
            registration_group: zone,
            last_inspection: inspectionDate
        })
        .eq('driver_id', driverId);

    if (error) throw error;

    // Send a system alert (broadcast) informing the driver of their verification
    await supabaseClient.from('system_alerts').insert([{
        tmo_id: tmoId,
        title: 'Account Verified!',
        message: 'Congratulations! Your driver account has been officially verified by the TMO. You can now start accepting rides and managing your profile.',
        type: 'success'
    }]);

    return true;
}

export async function sendBroadcast(title, message, type, tmoId) {
    const { error } = await supabaseClient
        .from('system_alerts')
        .insert([{
            tmo_id: tmoId,
            title: title,
            message: message,
            type: type // 'info', 'warning', 'danger'
        }]);

    if (error) throw error;
    return true;
}

export async function getBroadcastHistory() {
    const { data, error } = await supabaseClient
        .from('system_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) throw error;
    return data;
}
export async function getDriverRatings(driverIds) {
    const { data, error } = await supabaseClient
        .from('rides')
        .select('driver_id, rating')
        .in('driver_id', driverIds)
        .not('rating', 'is', null);

    if (error) throw error;
    return data;
}

export async function deleteBroadcast(id) {
    const { error } = await supabaseClient
        .from('system_alerts')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}
