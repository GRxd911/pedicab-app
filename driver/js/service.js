
import { supabaseClient } from '../../shared/js/config/config.js';

export async function getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data.session) return null;
    return data.session;
}

export async function getDriverProfile(userId) {
    const { data, error } = await supabaseClient
        .from('drivers')
        .select('pedicab_plate, status, last_status_change, verification_status')
        .eq('driver_id', userId)
        .single();

    if (error) return null;
    return data;
}

export async function toggleDriverStatus(userId, newStatus) {
    const { error } = await supabaseClient
        .from('drivers')
        .update({
            status: newStatus,
            last_status_change: new Date().toISOString()
        })
        .eq('driver_id', userId);

    if (error) throw error;
    return true;
}

export async function getDailyEarnings(userId) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const { data: todayRides, error } = await supabaseClient
        .from('rides')
        .select('price')
        .eq('driver_id', userId)
        .eq('status', 'completed')
        .gte('request_time', todayStart.toISOString());

    if (error || !todayRides) return { count: 0, total: 0 };

    const count = todayRides.length;
    const total = todayRides.reduce((sum, r) => sum + parseFloat(r.price || 0), 0);

    return { count, total };
}

export async function getWeeklyEarnings(userId) {
    const now = new Date();
    const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

    const { data: weekRides, error } = await supabaseClient
        .from('rides')
        .select('price')
        .eq('driver_id', userId)
        .eq('status', 'completed')
        .gte('request_time', weekAgo.toISOString());

    if (error || !weekRides) return { total: 0 };
    const total = weekRides.reduce((sum, r) => sum + parseFloat(r.price || 0), 0);
    return { total };
}

export async function getRecentHistory(userId) {
    const { data: recentTrips } = await supabaseClient
        .from('rides')
        .select('*')
        .eq('driver_id', userId)
        .eq('status', 'completed')
        .order('request_time', { ascending: false })
        .limit(5);

    return recentTrips || [];
}

export async function updateProfile(userId, fullname, phone, preferredColor) {
    // 1. Update Auth Metadata
    const { error: authError } = await supabaseClient.auth.updateUser({
        data: {
            full_name: fullname,
            preferred_color: preferredColor
        }
    });
    if (authError) throw authError;

    // 2. Update Public Users Table
    const { error: dbError } = await supabaseClient
        .from('users')
        .update({
            fullname: fullname,
            phone: phone,
            preferred_color: preferredColor
        })
        .eq('id', userId);

    if (dbError) throw dbError;
    return true;
}

export async function uploadAvatar(userId, file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Math.random()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage
        .from('profiles')
        .upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabaseClient.storage
        .from('profiles')
        .getPublicUrl(filePath);

    return publicUrl;
}

export async function getSystemAlerts() {
    const { data } = await supabaseClient
        .from('system_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
    return data || [];
}
