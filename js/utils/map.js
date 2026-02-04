
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

/**
 * Update marker position with smooth animation
 */
export function updateMarkerPosition(id, lat, lng, icon = null) {
    if (markers[id]) {
        const marker = markers[id];
        const startLatLng = marker.getLatLng();
        const endLatLng = L.latLng(lat, lng);

        // Simple linear interpolation for smoothness if distance is small
        const duration = 1000; // 1s animation
        const start = performance.now();

        function animate(time) {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);

            const currentLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * progress;
            const currentLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * progress;

            marker.setLatLng([currentLat, currentLng]);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);

        if (icon) {
            marker.setIcon(L.divIcon({
                className: 'custom-marker',
                html: icon,
                iconSize: [40, 40],
                iconAnchor: [20, 40]
            }));
        }
    }
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
        <div style="background: #10b981; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(16, 185, 129, 0.3); transform: translateY(-5px);">
            <i class='bx bxs-car' style="color: white; font-size: 22px;"></i>
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
        fitSelectedRoutes: true,
        showAlternatives: false,
        lineOptions: {
            styles: [
                { color: '#1e1b4b', opacity: 0.1, weight: 10 }, // Outer glow
                { color: options.color || '#4f46e5', opacity: 1, weight: 6 } // Main line
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
                    distance: (currentRoute.summary.totalDistance / 1000).toFixed(2), // km
                    duration: Math.round(currentRoute.summary.totalTime / 60) // minutes
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
        fitSelectedRoutes: true,
        showAlternatives: false,
        lineOptions: {
            styles: [
                { color: '#064e3b', opacity: 0.1, weight: 10 },
                { color: options.color || '#10b981', opacity: 1, weight: 6 }
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
                distance: (currentRoute.summary.totalDistance / 1000).toFixed(2),
                duration: Math.round(currentRoute.summary.totalTime / 60)
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
 * Fit map to show all markers
 */
export function fitBounds() {
    const markerArray = Object.values(markers);
    if (markerArray.length > 0) {
        const group = L.featureGroup(markerArray);
        map.fitBounds(group.getBounds().pad(0.1));
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
