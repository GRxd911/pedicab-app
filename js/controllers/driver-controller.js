
import { initAudio, playNotificationSound, playAlertSound } from '../services/audio.js';
import { updateAvatarUI, updateStatusUI, previewAvatar, applyTheme, activateSOSUI } from '../utils/ui.js';
import * as DriverService from '../services/driver.js';
import * as RideService from '../services/rides.js';
import { supabaseClient } from '../services/config.js';
import {
    initMap,
    addMarker,
    addDriverMarker,
    addPassengerMarker,
    addDestinationMarker,
    drawRoute,
    drawMultiPointRoute,
    fitBounds,
    centerMap,
    updateMarkerPosition,
    clearAllMarkers,
    clearRoute,
    addSOSMarker
} from '../utils/map.js';
import {
    getCurrentPosition,
    geocodeAddress,
    watchPosition,
    stopWatchingPosition,
    updateDriverLocation,
    calculateDistance
} from '../services/location.js';

// State
let currentUser = null;
let currentStatus = 'offline';
let lastStatusChange = null;
let pendingAcceptRideId = null;
let verificationStatus = 'pending';
let driverMap = null;
let locationWatchId = null;
let currentDriverLat = null;
let currentDriverLng = null;

// --- INITIALIZATION ---
async function init() {
    console.log('🚀 Driver App Initializing...');
    try {
        // 1. Check Session
        const session = await DriverService.getSession();
        if (!session) {
            console.log('No session found, redirecting to signin');
            window.location.href = 'signin.html';
            return;
        }

        currentUser = session.user;
        console.log('User authenticated:', currentUser.id);

        // 2. Basic UI Setup
        const name = currentUser.user_metadata?.full_name || 'Driver Partner';
        const plateEl = document.getElementById('driver-plate');
        const nameEl = document.getElementById('driver-name');

        if (nameEl) nameEl.innerText = name;
        if (document.getElementById('disp-name')) document.getElementById('disp-name').innerText = name;
        if (document.getElementById('disp-email')) document.getElementById('disp-email').innerText = currentUser.email;

        updateAvatarUI(currentUser.user_metadata?.avatar_url);

        // 3. Apply Background Color
        if (currentUser.user_metadata?.preferred_color) {
            applyTheme(currentUser.user_metadata.preferred_color);
        }

        // 4. Fetch Driver Profile
        console.log('Fetching driver profile...');
        const driverData = await DriverService.getDriverProfile(currentUser.id);

        if (driverData) {
            console.log('Driver data found:', driverData.pedicab_plate);
            if (plateEl) plateEl.innerText = `Pedicab #${driverData.pedicab_plate}`;
            if (document.getElementById('disp-plate')) document.getElementById('disp-plate').innerText = driverData.pedicab_plate;

            currentStatus = driverData.status || 'offline';
            lastStatusChange = driverData.last_status_change;
            verificationStatus = driverData.verification_status || 'pending';

            // Sync Service
            RideService.setRideServiceStatus(currentStatus);

            // Update Status UI
            updateStatusUI(currentStatus);
            updateActiveTime();
            loadEarnings();

            // Setup Realtime Listeners
            await RideService.setupRideListener(currentUser.id, () => {
                checkContextAndLoad();
            });

            setupStatusListener();
            setupAlertListener();
            setupEmergencyListener();

            if (currentStatus === 'online') {
                checkContextAndLoad();
            }
        } else {
            console.warn('No driver profile found for this user');
            if (plateEl) plateEl.innerText = 'No Plate Assigned';
            updateStatusUI('offline');
        }

        // 5. Setup Interactive Elements
        ['click', 'touchstart', 'mousedown'].forEach(evt => {
            document.addEventListener(evt, initAudio, { once: true });
        });

        // Start checking context
        checkContextAndLoad();

        // Initialize Map with a delay to ensure container visibility
        setTimeout(initDriverMap, 1500);

    } catch (err) {
        console.error('CRITICAL INIT ERROR:', err);
        // Alert the user so they can see if it's a specific JS error
        // alert('Initialization Error: ' + err.message);
    }

    // Refresh active time every minute
    setInterval(updateActiveTime, 60000);
}

// --- CORE FUNCTIONS ---

async function checkContextAndLoad() {
    if (!currentUser) return;
    try {
        const activeRide = await RideService.fetchActiveRide(currentUser.id);
        if (activeRide) {
            showActiveRideUI(activeRide);
        } else {
            const pendingRides = await RideService.fetchPendingRides(currentUser.id);
            renderPendingRides(pendingRides);
        }
    } catch (e) {
        console.error('Context load error:', e);
    }
}

async function renderPendingRides(rides) {
    if (currentStatus !== 'online') return;
    if (document.querySelector('.active-trip')) return;

    const container = document.getElementById('ride-request-container');
    if (!container) return;

    if (rides.length === 0) {
        container.innerHTML = `
            <div id="waiting-msg" style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px; background: white; margin: 0 20px 20px; border-radius: 24px;">
                Searching for passenger requests...
            </div>`;
        return;
    }

    container.innerHTML = '';
    rides.forEach(ride => {
        const userData = ride.passenger || { fullname: 'Passenger' };
        const passengerName = userData.fullname;
        const pickup = (ride.pickup_location || 'Unknown').replace(/'/g, "\\'");
        const dropoff = (ride.dropoff_location || 'Unknown').replace(/'/g, "\\'");

        const card = document.createElement('div');
        card.className = 'request-notification';
        card.innerHTML = `
            <div class="notification-header">
                <span class="tag-new">NEW REQUEST</span>
                <span style="font-size: 12px; font-weight: 700; color: var(--secondary);">${ride.price > 0 ? `₱${ride.price}` : 'Fare N/A'}</span>
            </div>
            <div class="req-details">
                <div class="req-avatar">
                   <i class='bx bxs-user'></i>
                </div>
                <div>
                    <h4 style="font-size: 14px;">${passengerName}</h4>
                    <p style="font-size: 12px; color: var(--text-muted);">${ride.pickup_location} → ${ride.dropoff_location}</p>
                </div>
            </div>
            <div class="btn-group">
                <button onclick="window.declineRide(${ride.ride_id})" class="btn btn-decline">Decline</button>
                <button onclick="window.acceptRide(${ride.ride_id}, '${pickup}', '${dropoff}')" class="btn btn-accept">Accept</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function showActiveRideUI(ride) {
    const container = document.getElementById('ride-request-container');
    if (!container) return;

    container.innerHTML = `
        <div class="request-notification active-trip" style="border: 2px solid #10b981;">
            <div class="notification-header">
                <span class="tag-new" style="background: #d1fae5; color: #059669;">IN PROGRESS</span>
            </div>
            <div style="margin-bottom: 15px;">
                <p style="font-size: 13px; color: var(--text-muted); text-align: center;">${ride.pickup_location} → ${ride.dropoff_location}</p>
            </div>
            <button onclick="window.openChat(${ride.ride_id}, 'Passenger')" class="btn" style="width: 100%; padding: 12px; background: #e0f2fe; color: var(--primary); margin-bottom: 10px; font-weight: 600;"><i class='bx bxs-chat'></i> Chat with Passenger</button>
            <button onclick="window.openCompleteOverlay(${ride.ride_id}, '${ride.pickup_location.replace(/'/g, "\\'")}', '${ride.dropoff_location.replace(/'/g, "\\'")}')" class="btn" style="width: 100%; padding: 12px; background: #10b981;">Finish Trip & Set Fare</button>
        </div>
    `;

    // Also update navigation route if available
    showNavigationRoute(ride);
}

async function loadEarnings() {
    try {
        const stats = await DriverService.getDailyEarnings(currentUser.id);
        const tripsEl = document.getElementById('total-trips');
        const earningsEl = document.getElementById('total-earnings');
        const todayEarnEl = document.getElementById('modal-today-earn');

        if (tripsEl) tripsEl.innerText = stats.count;
        if (earningsEl) earningsEl.innerText = `₱${stats.total.toLocaleString()}`;
        if (todayEarnEl) todayEarnEl.innerText = `₱${stats.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    } catch (e) {
        console.warn('Error loading earnings:', e);
    }
}

function updateActiveTime() {
    if (currentStatus !== 'online' || !lastStatusChange) {
        const hEl = document.getElementById('active-hours');
        if (hEl) hEl.innerText = '0h 0m';
        const fw = document.getElementById('fatigue-warning');
        if (fw) fw.style.display = 'none';
        return;
    }

    const start = new Date(lastStatusChange);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    const hoursEl = document.getElementById('active-hours');
    if (hoursEl) hoursEl.innerText = `${hours}h ${mins}m`;

    const warning = document.getElementById('fatigue-warning');
    if (warning && hours >= 4) {
        warning.style.display = 'flex';
        const msg = document.getElementById('active-duration-msg');
        if (msg) msg.innerText = `${hours} hours and ${mins} minutes`;
    } else if (warning) {
        warning.style.display = 'none';
    }
}

// --- MAP INTEGRATION ---

function initDriverMap() {
    if (driverMap) return;
    const container = document.getElementById('driver-map');
    if (!container) return;

    getCurrentPosition().then(pos => {
        currentDriverLat = pos.lat;
        currentDriverLng = pos.lng;

        driverMap = initMap('driver-map', { lat: pos.lat, lng: pos.lng }, 15);

        // Add pulsating self marker
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`driver-${currentUser.id}`, pos.lat, pos.lng, {
            icon: userIcon,
            title: "You",
            popup: "Your Current Position"
        });

        startTrackingLocation();
    }).catch(err => {
        console.warn('Map initialization failed (Location denied?):', err);
    });
}

function startTrackingLocation() {
    if (locationWatchId) return;

    locationWatchId = watchPosition(async (pos) => {
        currentDriverLat = pos.lat;
        currentDriverLng = pos.lng;

        // Update local map marker
        if (driverMap) {
            updateMarkerPosition(`driver-${currentUser.id}`, pos.lat, pos.lng);
        }

        // Broadcast to DB
        updateDriverLocation(currentUser.id, pos.lat, pos.lng);
    });
}

async function showNavigationRoute(ride) {
    if (!driverMap) return;

    clearAllMarkers();
    clearRoute();

    if (currentDriverLat && currentDriverLng) {
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`driver-${currentUser.id}`, currentDriverLat, currentDriverLng, {
            icon: userIcon,
            title: "You",
            popup: "Your Current Position"
        });

        const points = [{ lat: currentDriverLat, lng: currentDriverLng }];
        if (ride.pickup_lat) {
            addPassengerMarker('pickup', ride.pickup_lat, ride.pickup_lng, 'Pickup');
            points.push({ lat: ride.pickup_lat, lng: ride.pickup_lng });
        }
        if (ride.dropoff_lat) {
            addDestinationMarker(ride.dropoff_lat, ride.dropoff_lng, 'Dropoff');
            points.push({ lat: ride.dropoff_lat, lng: ride.dropoff_lng });
        }

        if (points.length >= 2) {
            drawMultiPointRoute(points);
            fitBounds();
        }
    }
}

// --- GLOBAL EXPORTS ---

window.toggleStatus = async () => {
    const btn = document.getElementById('online-toggle');
    if (!btn) return;

    const isGoingOffline = btn.innerText.includes('Offline');
    const newStatus = isGoingOffline ? 'offline' : 'online';

    if (!isGoingOffline && verificationStatus !== 'verified') {
        alert('Your account is not yet verified. Please wait for TMO approval.');
        return;
    }

    try {
        btn.innerText = 'Updating...';
        await DriverService.toggleDriverStatus(currentUser.id, newStatus);

        currentStatus = newStatus;
        lastStatusChange = new Date().toISOString();
        updateStatusUI(newStatus);
        RideService.setRideServiceStatus(newStatus);

        if (newStatus === 'online') {
            playNotificationSound(true);
            checkContextAndLoad();
        }
    } catch (e) {
        alert('Failed to update status: ' + e.message);
        updateStatusUI(currentStatus);
    }
};

window.acceptRide = async (rideId, pickup, dropoff) => {
    try {
        await RideService.acceptRide(rideId, currentUser.id);
        alert('Ride Accepted!');
        checkContextAndLoad();
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

window.declineRide = async (rideId) => {
    if (!confirm('Ignore this request?')) return;
    try {
        await RideService.declineRide(rideId, currentUser.id);
        checkContextAndLoad();
    } catch (e) {
        console.error(e);
    }
};

window.openCompleteOverlay = (rideId, pickup, dropoff) => {
    pendingAcceptRideId = rideId;
    const cf = document.getElementById('custom-fare');
    if (cf) cf.value = '';
    const fp = document.getElementById('fare-pickup');
    if (fp) fp.innerText = pickup;
    const fd = document.getElementById('fare-dropoff');
    if (fd) fd.innerText = dropoff;
    document.getElementById('fareOverlay').style.display = 'flex';
};

window.setFareField = (amount) => {
    const cf = document.getElementById('custom-fare');
    if (cf) cf.value = amount;
};

window.submitFare = async () => {
    const val = document.getElementById('custom-fare').value;
    if (!val || val <= 0) return alert('Enter a valid amount');

    try {
        document.getElementById('confirm-fare-btn').innerText = 'Processing...';
        await RideService.completeTrip(pendingAcceptRideId, val);
        location.reload();
    } catch (e) {
        alert('Failed: ' + e.message);
        document.getElementById('confirm-fare-btn').innerText = 'Complete Trip';
    }
};

window.logout = async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'signin.html';
};

window.openChat = (rideId, name) => {
    const overlay = document.getElementById('chatOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
        document.getElementById('chat-passenger-name').innerText = name;
        // Simple chat logic can go here or in separate file
    }
};

window.closeChat = () => {
    document.getElementById('chatOverlay').style.display = 'none';
};

window.closeProfile = (e) => {
    if (e.target.id === 'profileOverlay') document.getElementById('profileOverlay').style.display = 'none';
};

window.openEditProfile = () => {
    document.getElementById('editProfileOverlay').style.display = 'flex';
    // Populate fields
    document.getElementById('edit-fullname').value = currentUser.user_metadata?.full_name || '';
    document.getElementById('edit-phone').value = currentUser.user_metadata?.phone || '';
    document.getElementById('edit-color').value = currentUser.user_metadata?.preferred_color || '#4f46e5';
};

window.closeEditProfile = (e) => {
    if (e.target.id === 'editProfileOverlay' || e.target.classList.contains('bx-x')) {
        document.getElementById('editProfileOverlay').style.display = 'none';
    }
};

window.saveProfile = async () => {
    const name = document.getElementById('edit-fullname').value;
    const phone = document.getElementById('edit-phone').value;
    const color = document.getElementById('edit-color').value;
    const avatarFile = document.getElementById('avatar-upload').files[0];

    if (!name) return alert('Name is required');

    const btn = document.getElementById('save-profile-btn');
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        let avatarUrl = currentUser.user_metadata?.avatar_url;
        if (avatarFile) {
            avatarUrl = await DriverService.uploadAvatar(currentUser.id, avatarFile);
        }

        await DriverService.updateProfile(currentUser.id, name, phone, color);

        // Update auth metadata manually for immediate sync
        await supabaseClient.auth.updateUser({
            data: { full_name: name, avatar_url: avatarUrl, preferred_color: color }
        });

        alert('Profile updated!');
        location.reload();
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText = 'Save Changes';
        btn.disabled = false;
    }
};

window.switchTab = (tab) => {
    const homeView = document.getElementById('view-home');
    const mapView = document.getElementById('view-map');
    const navHome = document.getElementById('nav-home');
    const navMap = document.getElementById('nav-map');
    const navHistory = document.getElementById('nav-history');
    const navProfile = document.getElementById('nav-profile');

    if (homeView) homeView.classList.remove('active');
    if (mapView) mapView.classList.remove('active');
    if (navHome) navHome.classList.remove('active');
    if (navMap) navMap.classList.remove('active');
    if (navHistory) navHistory.classList.remove('active');
    if (navProfile) navProfile.classList.remove('active');

    if (tab === 'home' && homeView) {
        homeView.classList.add('active');
        navHome.classList.add('active');
        checkContextAndLoad();
    } else if (tab === 'map' && mapView) {
        mapView.classList.add('active');
        navMap.classList.add('active');
        setTimeout(initExplorationMap, 100);
    } else if (tab === 'history') {
        homeView.classList.add('active');
        if (navHistory) navHistory.classList.add('active');
        document.getElementById('earningsOverlay').style.display = 'flex';
        loadEarnings();
    } else if (tab === 'profile') {
        homeView.classList.add('active');
        if (navProfile) navProfile.classList.add('active');
        document.getElementById('profileOverlay').style.display = 'flex';
    }
};

async function initExplorationMap() {
    const lat = currentDriverLat || 9.3068;
    const lng = currentDriverLng || 123.3033;

    driverMap = initMap('exploration-map', { lat, lng }, 14);
    clearAllMarkers();

    const userIcon = `<div class="user-location-marker"></div>`;
    addMarker(`driver-${currentUser.id}`, lat, lng, {
        icon: userIcon,
        title: "You",
        popup: "Your Position"
    });

    try {
        const rides = await RideService.fetchPendingRides(currentUser.id);
        rides.forEach(r => {
            if (r.pickup_lat) addPassengerMarker(r.ride_id, r.pickup_lat, r.pickup_lng, 'Request');
        });
    } catch (e) { }
}

function setupStatusListener() {
    supabaseClient.channel(`driver-status-${currentUser.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            table: 'drivers',
            filter: `driver_id=eq.${currentUser.id}`
        }, payload => {
            if (payload.new.status !== currentStatus) {
                currentStatus = payload.new.status;
                verificationStatus = payload.new.verification_status;
                updateStatusUI(currentStatus);
            }
        }).subscribe();
}

function setupAlertListener() {
    supabaseClient.channel('system-alerts')
        .on('postgres_changes', { event: 'INSERT', table: 'system_alerts' }, payload => {
            playAlertSound();
            document.getElementById('notif-dot').style.display = 'block';
        }).subscribe();
}

function setupEmergencyListener() {
    supabaseClient.channel('emergencies')
        .on('postgres_changes', { event: 'INSERT', table: 'emergencies' }, payload => {
            activateSOSUI(true);
            playAlertSound();
        }).subscribe();
}

// START
init();
