
import { supabaseClient } from './config.js';

export async function checkTMOSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session) {
        return null;
    }

    const role = session.user.user_metadata.role;
    // TMO or Admin allowed
    if (role !== 'tmo' && role !== 'admin') {
        await supabaseClient.auth.signOut();
        return null;
    }

    return session;
}

export async function logoutTMO() {
    await supabaseClient.auth.signOut();
    window.location.href = 'tmo-signin.html';
}
