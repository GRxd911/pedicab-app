import { calculateDistance } from '../services/location.js';

// Multi-Map Registry: Holds all active map instances
// Format: { containerId: { map, markers, routeControl } }
let instances = {};

/**
 * Initialize a map instance (Multi-instance support)
 */
export function initMap(containerId, center = { lat: 9.3068, lng: 123.3033 }, zoom = 15) {
    // If this specific container already has a map, just re-center and return it
    if (instances[containerId]) {
        const inst = instances[containerId];
        if (inst.map) {
            inst.map.setView([center.lat, center.lng], zoom);
            setTimeout(() => inst.map.invalidateSize(), 150);
            return inst.map;
        }
    }

    // Create a brand new independent map instance
    const map = L.map(containerId, {
        zoomControl: true,
        attributionControl: true,
        fadeAnimation: true
    }).setView([center.lat, center.lng], zoom);

    // Use OSM tiles for reliability
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        crossOrigin: true
    }).addTo(map);

    // Add CSS for smooth transitions
    if (!document.getElementById('map-sync-engine-styles')) {
        const style = document.createElement('style');
        style.id = 'map-sync-engine-styles';
        style.innerHTML = `
            .leaflet-marker-icon { transition: transform 0.8s linear, opacity 0.3s ease; }
            .custom-marker { transition: all 0.8s linear; }
        `;
        document.head.appendChild(style);
    }

    // Register this instance
    instances[containerId] = {
        map: map,
        markers: {},
        routeControl: null
    };

    return map;
}

/**
 * Add a marker - Automatically syncs across ALL active map instances
 */
export function addMarker(id, lat, lng, options = {}) {
    const nLat = Number(lat);
    const nLng = Number(lng);

    // 🛑 BLOCK OCEAN BUG: Ignore invalid coordinates like 0,0 during initialization
    if (isNaN(nLat) || isNaN(nLng) || (nLat === 0 && nLng === 0)) {
        console.warn(`⚠️ Ignoring invalid coordinates for marker ${id}:`, lat, lng);
        return;
    }

    Object.keys(instances).forEach(cid => {
        const inst = instances[cid];

        // Remove existing marker for this ID on this specific map
        if (inst.markers[id]) {
            inst.map.removeLayer(inst.markers[id]);
        }

        let icon = null;
        if (options.icon) {
            const anchor = options.anchor || [20, 20];
            icon = L.divIcon({
                className: 'custom-marker',
                html: options.icon,
                iconSize: [40, 40],
                iconAnchor: anchor,
                popupAnchor: [0, -anchor[1] / 2]
            });
        }

        const marker = L.marker([nLat, nLng], {
            icon: icon,
            title: options.title || ''
        }).addTo(inst.map);

        if (options.popup) marker.bindPopup(options.popup);
        inst.markers[id] = marker;
    });
}

/**
 * Updates marker - Syncs across all active maps
 */
export function updateMarkerPosition(id, lat, lng, icon = null, options = {}) {
    const nLat = Number(lat);
    const nLng = Number(lng);

    // 🛑 BLOCK OCEAN BUG: Ignore invalid updates
    if (isNaN(nLat) || isNaN(nLng) || (nLat === 0 && nLng === 0)) return;

    Object.keys(instances).forEach(cid => {
        const inst = instances[cid];
        if (inst.markers[id]) {
            inst.markers[id].setLatLng([nLat, nLng]);
            if (icon) {
                const anchor = options.anchor || [20, 20];
                inst.markers[id].setIcon(L.divIcon({
                    className: 'custom-marker',
                    html: icon,
                    iconSize: [40, 40],
                    iconAnchor: anchor,
                    popupAnchor: [0, -anchor[1] / 2]
                }));
            }
            // Robust resize whenever movement occurs
            inst.map.invalidateSize();
        } else if (icon) {
            addMarker(id, lat, lng, { icon, ...options });
        }
    });
}

/**
 * Specialized Markers (Required for controller logic)
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

export function addDestinationMarker(lat, lng, address = 'Destination') {
    const icon = `
        <div style="background: #ef4444; width: 44px; height: 44px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg) translateY(-8px); display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(239, 68, 68, 0.3);">
            <i class='bx bxs-flag-alt' style="color: white; font-size: 22px; transform: rotate(45deg);"></i>
        </div>
    `;
    return addMarker('destination', lat, lng, {
        icon: icon,
        anchor: [20, 40],
        title: address,
        popup: `<b>Dropoff</b><br>${address}`
    });
}

export function addRideRequestMarker(ride, passengerName = 'Passenger') {
    const icon = `
        <div style="background: #4f46e5; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 8px 16px rgba(79, 70, 229, 0.3); transform: translateY(-5px);">
            <i class='bx bxs-user' style="color: white; font-size: 22px;"></i>
        </div>
    `;
    const pickup = (ride.pickup_location || 'Unknown').replace(/'/g, "\\'");
    const dropoff = (ride.dropoff_location || 'Unknown').replace(/'/g, "\\'");
    const popupHtml = `
        <div style="min-width: 200px; padding: 10px; text-align: center;">
            <b>${passengerName}</b><br>
            ₱${parseFloat(ride.price).toFixed(2)}<br>
            <button onclick="window.acceptRide(${ride.ride_id}, '${pickup}', '${dropoff}')" 
                style="background: #10b981; color: white; border: none; padding: 8px; border-radius: 8px; cursor: pointer; margin-top: 10px;">
                Accept
            </button>
        </div>
    `;
    return addMarker(`passenger-${ride.passenger_id || ride.ride_id}`, ride.pickup_lat, ride.pickup_lng, {
        icon: icon,
        title: passengerName,
        popup: popupHtml
    });
}

export function addSOSMarker(emergencyId, lat, lng, userName = 'Emergency') {
    const icon = `
        <div style="background: #dc2626; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 0 20px rgba(220, 38, 38, 0.8); animation: sosPulse 1s infinite;">
            <i class='bx bxs-error-alt' style="color: white; font-size: 28px;"></i>
        </div>
    `;
    return addMarker(`sos-${emergencyId}`, lat, lng, {
        icon: icon,
        title: `SOS - ${userName}`,
        popup: `<b style="color: #dc2626;">🚨 EMERGENCY SOS</b><br>${userName}`
    });
}

/**
 * Routing Engine (Synchronized)
 */

export function drawMultiPointRoute(points, options = {}) {
    Object.keys(instances).forEach(cid => {
        const inst = instances[cid];
        const cleanPoints = points.filter(p => p && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)));
        if (cleanPoints.length < 2) return;

        if (inst.routeControl) inst.map.removeControl(inst.routeControl);

        const waypoints = cleanPoints.map(p => L.latLng(Number(p.lat), Number(p.lng)));
        inst.routeControl = L.Routing.control({
            waypoints: waypoints,
            show: false,
            itinerary: { show: false },
            createMarker: () => null,
            lineOptions: {
                styles: [{ color: options.color || '#10b981', opacity: 0.8, weight: 6 }]
            },
            router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
        }).addTo(inst.map);

        inst.routeControl.on('routesfound', (e) => {
            if (options.onRouteFound) options.onRouteFound({
                distance: e.routes[0].summary.totalDistance,
                duration: e.routes[0].summary.totalTime
            });
        });
    });
}

export function drawRoute(sLat, sLng, eLat, eLng, options = {}) {
    return drawMultiPointRoute([{ lat: sLat, lng: sLng }, { lat: eLat, lng: eLng }], options);
}

export function clearRoute() {
    Object.keys(instances).forEach(cid => {
        if (instances[cid].routeControl) {
            instances[cid].map.removeControl(instances[cid].routeControl);
            instances[cid].routeControl = null;
        }
    });
}

/**
 * Global Utility Functions
 */

/**
 * Fit bounds - Each map fits its own markers independently
 * 🛡️ HARDENED: Strictly ignores invalid coordinates (0,0) to prevent Ocean Bug
 */
export function fitBounds() {
    Object.keys(instances).forEach(cid => {
        const inst = instances[cid];

        // Filter out any markers at 0,0 or invalid locations
        const validMarkers = Object.values(inst.markers).filter(m => {
            const ll = m.getLatLng();
            return ll && ll.lat !== 0 && ll.lng !== 0;
        });

        if (validMarkers.length === 0) return;

        // Force multi-stage resize to fix Gray Box issue
        const wakeUp = () => inst.map.invalidateSize();
        wakeUp();
        setTimeout(wakeUp, 500);
        setTimeout(wakeUp, 1000);

        if (validMarkers.length === 1) {
            inst.map.setView(validMarkers[0].getLatLng(), 16, { animate: true });
        } else {
            const group = L.featureGroup(validMarkers);
            const bounds = group.getBounds();

            // Safety check: if bounds are too wide (ocean bug), center on first valid point
            if (bounds.getNorthWest().distanceTo(bounds.getSouthEast()) > 500000) { // > 500km
                inst.map.setView(validMarkers[0].getLatLng(), 16);
            } else {
                inst.map.fitBounds(bounds.pad(0.3), { maxZoom: 16, animate: true });
            }
        }
    });
}

export function centerMap(lat, lng, zoom = 15) {
    Object.keys(instances).forEach(cid => {
        instances[cid].map.setView([lat, lng], zoom);
    });
}

export function removeMarker(id) {
    Object.keys(instances).forEach(cid => {
        if (instances[cid].markers[id]) {
            instances[cid].map.removeLayer(instances[cid].markers[id]);
            delete instances[cid].markers[id];
        }
    });
}

export function clearAllMarkers() {
    Object.keys(instances).forEach(cid => {
        Object.keys(instances[cid].markers).forEach(id => {
            instances[cid].map.removeLayer(instances[cid].markers[id]);
        });
        instances[cid].markers = {};
    });
}

export function destroyMap(containerId) {
    if (instances[containerId]) {
        instances[containerId].map.remove();
        delete instances[containerId];
    }
}

export function getMap(containerId) {
    return instances[containerId] ? instances[containerId].map : null;
}
