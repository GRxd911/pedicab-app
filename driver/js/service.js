
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

export async function updateProfile(userId, fullname, phone, avatarUrl, preferredColor) {
    // 0. Ensure session is active
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please sign in again to save changes.");

    // 1. Update Auth Metadata
    const { error: authError } = await supabaseClient.auth.updateUser({
        data: {
            full_name: fullname,
            avatar_url: avatarUrl,
            preferred_color: preferredColor
        }
    });
    if (authError) {
        console.error('Auth update error:', authError);
        // If it's a 403, it's likely a session refresh issue
        if (authError.status === 403) throw new Error("Security check failed. Please refresh the page and try again.");
        throw authError;
    }

    // 2. Update Public Users Table
    const { error: dbError } = await supabaseClient
        .from('users')
        .update({
            fullname: fullname,
            phone: phone,
            avatar_url: avatarUrl,
            preferred_color: preferredColor
        })
        .eq('id', userId);

    if (dbError) throw dbError;
    return true;
}

export async function uploadAvatar(userId, file) {
    // 1. Ensure absolute latest session is active
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !session) {
        console.error('Session Error:', sessionError);
        throw new Error("Authentication session missing or expired. Please sign out and sign in again.");
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`; // Use Date.now() for unique filenames
    const filePath = `avatars/${fileName}`;

    console.log('Uploading avatar for session user:', session.user.id);

    const { data, error: uploadError } = await supabaseClient.storage
        .from('profiles')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true // Allow overwriting if same name
        });

    if (uploadError) {
        console.error('Avatar upload error details:', uploadError);
        if (uploadError.status === 403) throw new Error("Permission denied. Ensure the 'profiles' storage bucket is public.");
        throw uploadError;
    }

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
