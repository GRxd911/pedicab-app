
/**
 * Map Utility - Handles Leaflet map initialization and real-time tracking
 * Uses FREE Leaflet + CartoDB tiles + Leaflet Routing Machine
 */

import { calculateDistance } from '../services/location.js';

let map = null;
let markers = {};
let routeControl = null;
let currentRoute = null;

/**
 * Initialize map with Leaflet and CartoDB tiles
 */
export function initMap(containerId, center = { lat: 10.3157, lng: 123.8854 }, zoom = 13) {
    // Remove existing map if any
    if (map) {
        map.remove();
        markers = {}; // Clear stale marker references to prevent "layer not found" errors on new map
    }

    // Create map
    map = L.map(containerId, {
        zoomControl: true,
        attributionControl: true
    }).setView([center.lat, center.lng], zoom);

    // Add CartoDB tile layer (beautiful, free, no API key)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    return map;
}

/**
 * Add a marker to the map
 */
export function addMarker(id, lat, lng, options = {}) {
    // Remove existing marker if it exists
    if (markers[id]) {
        map.removeLayer(markers[id]);
    }

    // Create custom icon if specified
    let icon = null;
    if (options.icon) {
        icon = L.divIcon({
            className: 'custom-marker',
            html: options.icon,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        });
    }

    // Create marker
    const marker = L.marker([lat, lng], {
        icon: icon,
        title: options.title || ''
    }).addTo(map);

    // Add popup if specified
    if (options.popup) {
        marker.bindPopup(options.popup);
    }

    // Store marker
    markers[id] = marker;

    return marker;
}

export function updateMarkerPosition(id, lat, lng, icon = null) {
    if (markers[id]) {
        markers[id].setLatLng([lat, lng]);
        if (icon) {
            markers[id].setIcon(L.divIcon({
                className: 'custom-marker',
                html: icon,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            }));
        }
        if (map) map.invalidateSize(); // Fix hidden container issues
        return true;
    } else if (icon) {
        addMarker(id, lat, lng, { icon });
        return true;
    }
    return false;
}

/**
 * Remove marker from map
 */
export function removeMarker(id) {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
}

/**
 * Add driver marker (car icon)
 */
export function addDriverMarker(driverId, lat, lng, driverName = 'Driver') {
    const icon = `
        <div class="driver-marker-premium">
            <div class="marker-halo"></div>
            <div class="marker-core">
                <i class='bx bxs-car'></i>
            </div>
        </div>
    `;

    return addMarker(`driver-${driverId}`, lat, lng, {
        icon: icon,
        title: driverName,
        popup: `<b>${driverName}</b><br>Driver Location`
    });
}

/**
 * Add passenger marker (person icon)
 */
export function addPassengerMarker(passengerId, lat, lng, passengerName = 'Passenger') {
    const icon = `
        <div style="background: #4f46e5; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(79, 70, 229, 0.3); transform: translateY(-5px);">
            <i class='bx bxs-user' style="color: white; font-size: 22px;"></i>
        </div>
    `;

    return addMarker(`passenger-${passengerId}`, lat, lng, {
        icon: icon,
        title: passengerName,
        popup: `<b>${passengerName}</b><br>Pickup Location`
    });
}

/**
 * Add ride request marker for drivers (with Accept/Decline in popup)
 */
export function addRideRequestMarker(ride, passengerName = 'Passenger') {
    const icon = `
        <div style="background: #4f46e5; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(79, 70, 229, 0.3); transform: translateY(-5px);">
            <i class='bx bxs-user' style="color: white; font-size: 22px;"></i>
        </div>
    `;

    const pickup = (ride.pickup_location || 'Unknown').replace(/'/g, "\\'");
    const dropoff = (ride.dropoff_location || 'Unknown').replace(/'/g, "\\'");

    const popupHtml = `
        <div style="min-width: 200px; font-family: 'Outfit', sans-serif; padding: 10px; text-align: center;">
            <div style="margin-bottom: 12px;">
                <b style="font-size: 16px; color: #1e293b; display: block;">${passengerName}</b>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.4;">
                    <i class='bx bxs-map-pin' style="color: #10b981;"></i> ${ride.pickup_location}<br>
                    <i class='bx bxs-flag-alt' style="color: #ef4444;"></i> ${ride.dropoff_location}
                </div>
            </div>
            <div style="background: #f8fafc; padding: 8px; border-radius: 12px; color: #4f46e5; font-weight: 800; font-size: 18px; margin-bottom: 15px; border: 1px dashed #e2e8f0;">
                ₱${parseFloat(ride.price).toFixed(2)}
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.declineRide(${ride.ride_id})" 
                    style="flex: 1; background: #fee2e2; color: #dc2626; border: none; padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 13px; transition: all 0.2s;">
                    Decline
                </button>
                <button onclick="window.acceptRide(${ride.ride_id}, '${pickup}', '${dropoff}')" 
                    style="flex: 1.5; background: #10b981; color: white; border: none; padding: 12px; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 13px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
                    Accept
                </button>
            </div>
        </div>
    `;

    // Use passenger_id for the ID to ensure it overwrites standard passenger markers
    return addMarker(`passenger-${ride.passenger_id || ride.ride_id}`, ride.pickup_lat, ride.pickup_lng, {
        icon: icon,
        title: passengerName,
        popup: popupHtml
    });
}

/**
 * Add destination marker (flag icon)
 */
export function addDestinationMarker(lat, lng, address = 'Destination') {
    const icon = `
        <div style="background: #ef4444; width: 44px; height: 44px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg) translateY(-8px); display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(239, 68, 68, 0.3);">
            <i class='bx bxs-flag-alt' style="color: white; font-size: 22px; transform: rotate(45deg);"></i>
        </div>
    `;

    return addMarker('destination', lat, lng, {
        icon: icon,
        title: address,
        popup: `<b>Dropoff</b><br>${address}`
    });
}

/**
 * Add SOS emergency marker (pulsing red)
 */
export function addSOSMarker(emergencyId, lat, lng, userName = 'Emergency') {
    const icon = `
        <div style="background: #dc2626; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 0 20px rgba(220, 38, 38, 0.8); animation: sosPulse 1s infinite;">
            <i class='bx bxs-error-alt' style="color: white; font-size: 28px;"></i>
        </div>
    `;

    const marker = addMarker(`sos-${emergencyId}`, lat, lng, {
        icon: icon,
        title: `SOS - ${userName}`,
        popup: `<b style="color: #dc2626;">🚨 EMERGENCY SOS</b><br>${userName}<br><a href="tel:911">Call 911</a>`
    });

    // Auto-open popup for SOS
    marker.openPopup();

    return marker;
}

/**
 * Draw route between two points using Leaflet Routing Machine
 */
export function drawRoute(startLat, startLng, endLat, endLng, options = {}) {
    // Remove existing route
    if (routeControl) {
        map.removeControl(routeControl);
    }

    // Create routing control
    routeControl = L.Routing.control({
        waypoints: [
            L.latLng(startLat, startLng),
            L.latLng(endLat, endLng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        showAlternatives: false,
        show: false, // Hide the itinerary instructions panel
        lineOptions: {
            styles: [
                { color: '#1e1b4b', opacity: 0.1, weight: 12 }, // Outer glow
                { color: options.color || '#4f46e5', opacity: 1, weight: 8 } // Main line
            ]
        },
        createMarker: function () { return null; }, // Don't create default markers
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        })
    }).addTo(map);

    // Listen for route found
    routeControl.on('routesfound', function (e) {
        const routes = e.routes;
        if (routes && routes.length > 0) {
            currentRoute = routes[0];

            // Call callback if provided
            if (options.onRouteFound) {
                options.onRouteFound({
                    distance: currentRoute.summary.totalDistance, // meters
                    duration: currentRoute.summary.totalTime // seconds
                });
            }
        }
    });

    return routeControl;
}

/**
 * Draw multi-point route (driver -> pickup -> dropoff)
 */
export function drawMultiPointRoute(points, options = {}) {
    if (routeControl) {
        map.removeControl(routeControl);
    }

    const waypoints = points.map(p => L.latLng(p.lat, p.lng));

    routeControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        showAlternatives: false,
        show: false, // Hide the itinerary instructions panel
        lineOptions: {
            styles: [
                { color: '#064e3b', opacity: 0.1, weight: 12 },
                { color: options.color || '#10b981', opacity: 1, weight: 8 }
            ]
        },
        createMarker: function () { return null; },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        })
    }).addTo(map);

    routeControl.on('routesfound', function (e) {
        const routes = e.routes;
        if (routes && routes.length > 0 && options.onRouteFound) {
            currentRoute = routes[0];
            options.onRouteFound({
                distance: currentRoute.summary.totalDistance, // meters
                duration: currentRoute.summary.totalTime // seconds
            });
        }
    });

    return routeControl;
}

/**
 * Clear route from map
 */
export function clearRoute() {
    if (routeControl) {
        map.removeControl(routeControl);
        routeControl = null;
        currentRoute = null;
    }
}

/**
 * Fit map to show all markers (Smartly)
 */
export function fitBounds() {
    if (!map) return;
    const markerArray = Object.values(markers);
    if (markerArray.length === 0) return;

    if (markerArray.length === 1) {
        // Only re-center if marker is NOT in view
        if (!map.getBounds().contains(markerArray[0].getLatLng())) {
            map.setView(markerArray[0].getLatLng(), 16, { animate: true });
        }
    } else {
        const group = L.featureGroup(markerArray);
        const bounds = group.getBounds();

        // Only fit bounds if markers are moving outside the current view
        // OR if the current view is way too zoomed in/out
        const currentBounds = map.getBounds();
        const padding = 0.3;

        if (!currentBounds.contains(bounds.pad(0.1))) {
            map.fitBounds(bounds.pad(padding), {
                maxZoom: 16,
                animate: true,
                duration: 0.8
            });
        }
    }
}

/**
 * Center map on specific location
 */
export function centerMap(lat, lng, zoom = 15) {
    map.setView([lat, lng], zoom);
}

/**
 * Get current map instance
 */
export function getMap() {
    return map;
}

/**
 * Clear all markers
 */
export function clearAllMarkers() {
    Object.keys(markers).forEach(id => removeMarker(id));
}

/**
 * Destroy map
 */
export function destroyMap() {
    if (map) {
        map.remove();
        map = null;
        markers = {};
        routeControl = null;
        currentRoute = null;
    }
}
