
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

        let hasResolved = false;
        let bestReading = null;

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                // console.log(`GPS Reading: ${accuracy.toFixed(1)}m accuracy`);

                // Store the best reading we've seen so far
                if (!bestReading || accuracy < bestReading.accuracy) {
                    bestReading = { lat: latitude, lng: longitude, accuracy };
                }

                // If we get a very good reading (under 30 meters), resolve immediately
                if (accuracy <= 30 && !hasResolved) {
                    hasResolved = true;
                    navigator.geolocation.clearWatch(watchId);
                    // console.log("✅ High accuracy lock acquired!");
                    resolve(bestReading);
                }
            },
            (error) => {
                console.warn('GPS Wait Error:', error.message);
                // Don't resolve immediately on error, wait for timeout in case it's a transient error
                // or if the user is clicking "Allow"
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 15000 // Wait up to 15s for the user to enable GPS/Allow permission
            }
        );

        // Timeout handler
        setTimeout(() => {
            if (!hasResolved) {
                hasResolved = true;
                navigator.geolocation.clearWatch(watchId);

                if (bestReading) {
                    console.log("⏱️ GPS timeout, using best reading:", bestReading.accuracy + "m");
                    resolve(bestReading);
                } else {
                    console.warn("❌ GPS failed to get any reading.");
                    resolve(null); // Return null to indicate failure
                }
            }
        }, 10000); // 10 second strict timeout
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
 * Get address suggestions for autocomplete
 */
export async function getAddressSuggestions(query, userLat = null, userLng = null) {
    if (!query || query.length < 2) return [];

    try {
        // Build priority parameters
        let locationParams = '';
        if (userLat && userLng) {
            // 1. proximity: biases search center
            locationParams += `&lat=${userLat}&lon=${userLng}`;

            // 2. viewbox: effectively boosts local results (approx 50km box)
            const delta = 0.4; // roughly 40-50km
            const left = userLng - delta;
            const top = userLat + delta;
            const right = userLng + delta;
            const bottom = userLat - delta;
            locationParams += `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
        }

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}${locationParams}&countrycodes=ph&limit=10&addressdetails=1`
        );
        const data = await response.json();

        const results = data.map(item => {
            const addr = item.address;
            let display = item.display_name;

            // Priority list for names
            const buildingName = addr.university || addr.school || addr.college ||
                addr.amenity || addr.building || addr.office ||
                addr.shop || addr.tourism || addr.historic || addr.mall;

            if (buildingName) {
                const road = addr.road || addr.suburb || addr.neighbourhood || '';
                display = road ? `${buildingName}, ${road}` : buildingName;
            } else if (addr.road) {
                display = addr.road + (addr.suburb ? `, ${addr.suburb}` : '');
            }

            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);

            // Calculate distance for sorting if user location is known
            let distance = 0;
            if (userLat && userLng) {
                distance = calculateDistance(userLat, userLng, lat, lng);
            }

            return {
                displayName: display,
                lat: lat,
                lng: lng,
                distance: distance // Store distance for sorting
            };
        });

        // 🟢 SORT BY DISTANCE (Nearest first)
        if (userLat && userLng) {
            results.sort((a, b) => a.distance - b.distance);
        }

        return results;
    } catch (error) {
        console.error('Autocomplete error:', error);
        return [];
    }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
        );
        const data = await response.json();

        if (data && data.address) {
            const addr = data.address;

            // PRIORITY: Specific Building/Place Name
            const placeName = addr.university || addr.school || addr.college ||
                addr.mall || addr.amenity || addr.building ||
                addr.office || addr.shop || addr.tourism || addr.historic;

            if (placeName) {
                const road = addr.road || addr.suburb || addr.neighbourhood || '';
                return road ? `${placeName}, ${road}` : placeName;
            }

            // FALLBACK 1: Road & Area
            if (addr.road) {
                const area = addr.suburb || addr.neighbourhood || addr.city || addr.town || addr.village || '';
                return area ? `${addr.road}, ${area}` : addr.road;
            }

            return data.display_name;
        }
    } catch (error) {
        console.error('Reverse geocoding error:', error);
    }

    return null;
}
