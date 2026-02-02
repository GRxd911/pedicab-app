
import { supabaseClient } from './config.js';

export async function fetchMessages(rideId) {
    const { data: msgs, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return msgs || [];
}

export async function sendMessage(rideId, senderId, content) {
    const { error } = await supabaseClient.from('messages').insert([{
        ride_id: rideId,
        sender_id: senderId,
        content: content
    }]);

    if (error) throw error;
    return true;
}
