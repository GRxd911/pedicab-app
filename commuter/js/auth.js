
import { supabaseClient } from '../../shared/js/config/config.js';

export async function checkPassengerSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) return null;
    return session;
}

export async function logoutPassenger() {
    await supabaseClient.auth.signOut();
    window.location.href = 'signin.html';
}
