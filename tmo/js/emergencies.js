
import { supabaseClient } from '../../shared/js/config/config.js';

export async function getActiveEmergencies() {
    const { data, error } = await supabaseClient
        .from('emergencies')
        .select('id, user_id, ride_id, type, created_at, status')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (error) return [];
    return data;
}

export async function getAllEmergencies() {
    const { data, error } = await supabaseClient
        .from('emergencies')
        .select(`
            *,
            passenger:user_id (
                fullname, 
                phone,
                emergency_contact_name,
                emergency_contact_phone
            ),
            rides:ride_id (
                status,
                driver:driver_id (
                    fullname,
                    drivers (
                        pedicab_plate
                    )
                )
            )
        `)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

export async function dismissEmergency(emergencyId) {
    // Usually we update status to 'resolved'
    const { error } = await supabaseClient
        .from('emergencies')
        .update({ status: 'resolved' })
        .eq('id', emergencyId);

    if (error) throw error;
    return true;
}

export async function clearAllResolved() {
    const { error } = await supabaseClient
        .from('emergencies')
        .delete()
        .eq('status', 'resolved');

    if (error) throw error;
    return true;
}
