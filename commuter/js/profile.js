
import { supabaseClient } from '../../shared/js/config/config.js';

export async function getProfileStats(userId) {
    const { count } = await supabaseClient
        .from('rides')
        .select('*', { count: 'exact', head: true })
        .eq('passenger_id', userId)
        .eq('status', 'completed');

    const { data } = await supabaseClient
        .from('users')
        .select('created_at')
        .eq('id', userId)
        .single();

    return {
        completedTrips: count || 0,
        joinedDate: data ? new Date(data.created_at) : null
    };
}

export async function getEmergencyContact(userId) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('emergency_contact_name, emergency_contact_phone')
        .eq('id', userId)
        .single();

    if (error) throw error;
    return data;
}

export async function updateEmergencyContact(userId, name, phone) {
    const { error } = await supabaseClient
        .from('users')
        .update({
            emergency_contact_name: name,
            emergency_contact_phone: phone
        })
        .eq('id', userId);

    if (error) throw error;
    return true;
}

export async function updateProfile(userId, fullname, phone, avatarFile, preferredColor) {
    // 0. Ensure session is active before proceeding (Critical for Vercel/Production)
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
        throw new Error("Authentication session missing. Please try logging in again.");
    }

    let avatarUrl = null;

    // Fetch current user to get existing avatarUrl if no new file
    const { data: currentUser } = await supabaseClient
        .from('users')
        .select('avatar_url, preferred_color')
        .eq('id', userId)
        .single();

    avatarUrl = currentUser?.avatar_url;
    const finalColor = preferredColor || currentUser?.preferred_color;

    if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${userId}-${Math.random()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabaseClient.storage
            .from('profiles')
            .upload(filePath, avatarFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabaseClient.storage
            .from('profiles')
            .getPublicUrl(filePath);

        avatarUrl = publicUrl;
    }

    // Update Auth Metadata
    const { error: authError } = await supabaseClient.auth.updateUser({
        data: {
            full_name: fullname,
            phone: phone,
            avatar_url: avatarUrl,
            preferred_color: finalColor
        }
    });
    if (authError) throw authError;

    // Update Public Users Table
    const { error: dbError } = await supabaseClient
        .from('users')
        .update({
            fullname: fullname,
            phone: phone,
            avatar_url: avatarUrl,
            preferred_color: finalColor
        })
        .eq('id', userId);

    if (dbError) throw dbError;

    return { avatarUrl };
}
