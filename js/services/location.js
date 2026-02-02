
import { supabaseClient } from './config.js';

// Default location (Dumaguete City center)
const DEFAULT_LOCATION = { lat: 9.3068, lng: 123.3033 };

/**
 * Get current GPS position
 */
export async function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            resolve(DEFAULT_LOCATION);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                });
            },
            (error) => {
                console.warn('Geolocation error:', error);
                resolve(DEFAULT_LOCATION);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0 // Do not use cached readings
            }
        );
    });
}

/**
 * Watch position changes (for real-time tracking)
 */
export function watchPosition(callback) {
    if (!navigator.geolocation) {
        console.warn('Geolocation not supported');
        return null;
    }

    const watchId = navigator.geolocation.watchPosition(
        (position) => {
            // RELAXED FILTER: 500 meters is better for initial testing
            if (position.coords.accuracy > 500) {
                console.log(`Skipping very low accuracy reading: ${position.coords.accuracy}m`);
                return;
            }

            callback({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                speed: position.coords.speed, // Useful for moving vehicles
                heading: position.coords.heading
            });
        },
        (error) => {
            console.warn('Watch position error:', error);
        },
        {
            enableHighAccuracy: true, // Force GPS
            timeout: 10000,           // Wait up to 10s for a good reading
            maximumAge: 0             // Do not use cached readings
        }
    );

    return watchId;
}

/**
 * Stop watching position
 */
export function stopWatchingPosition(watchId) {
    if (watchId && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
}

/**
 * Update driver's current location in database
 */
export async function updateDriverLocation(driverId, lat, lng) {
    const { error } = await supabaseClient
        .from('drivers')
        .update({
            current_lat: lat,
            current_lng: lng,
            last_location_update: new Date().toISOString()
        })
        .eq('driver_id', driverId);

    if (error) throw error;
    return true;
}

/**
 * Get driver's current location from database
 */
export async function getDriverLocation(driverId) {
    const { data, error } = await supabaseClient
        .from('drivers')
        .select('current_lat, current_lng, last_location_update')
        .eq('driver_id', driverId)
        .single();

    if (error) throw error;

    if (data && data.current_lat && data.current_lng) {
        return {
            lat: parseFloat(data.current_lat),
            lng: parseFloat(data.current_lng),
            lastUpdate: data.last_location_update
        };
    }

    return null;
}

/**
 * Calculate distance between two points (in kilometers)
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Geocode address to coordinates (using Nominatim - FREE)
 */
export async function geocodeAddress(address) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Dumaguete City, Philippines')}&limit=1`
        );
        const data = await response.json();

        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                displayName: data[0].display_name
            };
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }

    return null;
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await response.json();

        if (data && data.display_name) {
            return data.display_name;
        }
    } catch (error) {
        console.error('Reverse geocoding error:', error);
    }

    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
