
import { supabaseClient } from '../config/config.js';

// Default location (Dumaguete City center)
const DEFAULT_LOCATION = { lat: 9.3068, lng: 123.3033 };

/**
 * Get current GPS position with high accuracy
 * Waits for a high-accuracy reading (accuracy < 60m) or a timeout
 */
export async function getCurrentPosition() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn('Geolocation not supported');
            resolve(null);
            return;
        }

        // Fast resolution: Get the first available position
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                console.warn('GPS Error:', error.message);
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
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
            // HIGH ACCURACY FILTER: 100 meters is much better for real use cases
            // 500m was way too loose and allowed "jumping" to nearby streets
            if (position.coords.accuracy > 100) {
                console.log(`Filtering low accuracy reading: ${Math.round(position.coords.accuracy)}m`);
                return;
            }

            callback({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                speed: position.coords.speed,
                heading: position.coords.heading
            });
        },
        (error) => {
            console.warn('Watch position error:', error.message);
        },
        {
            enableHighAccuracy: true,
            timeout: 20000,           // Longer timeout for continuous tracking
            maximumAge: 0
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
 * Get address suggestions with acronym support and location-based priority
 */
export async function getAddressSuggestions(query, userLat = null, userLng = null) {
    if (!query || query.length < 1) return [];

    try {
        let searchQuery = query.trim();
        const upperQuery = searchQuery.toUpperCase();

        // 🏫 SMART ALIAS DICTIONARY: Handle common acronyms instantly
        const aliases = {
            'SUMC': 'Silliman University Medical Center',
            'NORSU': 'Negros Oriental State University',
            'Silliman': 'Silliman University',
            'SU': 'Silliman University',
            'SM': 'SM Mall',
            'UP': 'University of the Philippines',
            'MSU': 'Mindanao State University',
            'UST': 'University of Santo Tomas',
            'DLSU': 'De La Salle University',
            'ADMU': 'Ateneo de Manila University',
            'Rob': 'Robinsons Place',
            'Robs': 'Robinsons Place'
        };

        if (aliases[upperQuery]) {
            searchQuery = aliases[upperQuery];
        } else {
            // Check if it starts with an alias (e.g., "SM C")
            for (const key in aliases) {
                if (upperQuery.startsWith(key + ' ')) {
                    searchQuery = upperQuery.replace(key, aliases[key]);
                    break;
                }
            }
        }

        // Build priority parameters
        let locationParams = '';
        if (userLat && userLng) {
            // Priority viewbox helps the map server find things near the user first
            const delta = 0.5; // Roughly 50km radius
            const left = userLng - delta;
            const top = userLat + delta;
            const right = userLng + delta;
            const bottom = userLat - delta;
            locationParams += `&lat=${userLat}&lon=${userLng}&viewbox=${left},${top},${right},${bottom}&bounded=0`;
        }

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}${locationParams}&countrycodes=ph&limit=10&addressdetails=1`
        );
        const data = await response.json();

        return data.map(item => {
            const addr = item.address;
            let display = item.display_name;

            const buildingName = addr.university || addr.school || addr.college ||
                addr.amenity || addr.building || addr.office ||
                addr.shop || addr.tourism || addr.historic || addr.mall || addr.hospital;

            if (buildingName) {
                const road = addr.road || addr.suburb || addr.neighbourhood || '';
                display = road ? `${buildingName}, ${road}` : buildingName;
            } else if (addr.road) {
                display = addr.road + (addr.suburb ? `, ${addr.suburb}` : '');
            }

            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);

            let distance = 0;
            if (userLat && userLng) {
                distance = calculateDistance(userLat, userLng, lat, lng);
            }

            return {
                displayName: display,
                lat: lat,
                lng: lng,
                distance: distance
            };
        }).sort((a, b) => a.distance - b.distance);

    } catch (error) {
        console.error('Autocomplete error:', error);
        return [];
    }
}

// Simple cache to store addresses and prevent redundant API calls
const addressCache = new Map();

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat, lng) {
    // Round coordinates slightly to use as a cache key
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (addressCache.has(cacheKey)) {
        return addressCache.get(cacheKey);
    }

    try {
        // Safety: Timeout after 5 seconds so the app doesn't hang
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&app=pedicab-commuter-app`,
            { signal: controller.signal }
        );

        clearTimeout(timeoutId);
        const data = await response.json();

        if (data && data.address) {
            const addr = data.address;

            // PRIORITY: Specific Building/Place Name
            const placeName = addr.university || addr.school || addr.college ||
                addr.mall || addr.amenity || addr.building ||
                addr.office || addr.shop || addr.tourism || addr.historic;

            let result = null;
            if (placeName) {
                const road = addr.road || addr.suburb || addr.neighbourhood || '';
                result = road ? `${placeName}, ${road}` : placeName;
            } else if (addr.road) {
                // FALLBACK 1: Road & Area
                const area = addr.suburb || addr.neighbourhood || addr.city || addr.town || addr.village || '';
                result = area ? `${addr.road}, ${area}` : addr.road;
            } else {
                result = data.display_name;
            }

            if (result) {
                addressCache.set(cacheKey, result);
                return result;
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn('Map server timed out. Using fallback.');
        } else {
            console.error('Reverse geocoding error:', error);
        }
    }

    return null;
}
