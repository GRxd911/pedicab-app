
import { initAudio, playNotificationSound, playAlertSound } from '../services/audio.js';
import { updateAvatarUI, updateStatusUI, previewAvatar, applyTheme, activateSOSUI, showConfirm, showAlert } from '../utils/ui.js';
import * as DriverService from '../services/driver.js';
import * as RideService from '../services/rides.js';
import { supabaseClient } from '../services/config.js';
import {
    initMap,
    addMarker,
    addDriverMarker,
    addPassengerMarker,
    addRideRequestMarker,
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
let currentNavRideId = null;
let activeNavRide = null;
let isUpdatingNav = false;
let lastNavUpdatePos = null;

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

        // Initialize Map
        await initDriverMap();

        // Load active context (this draws markers/routes AFTER map is ready)
        await checkContextAndLoad();

    } catch (err) {
        console.error('CRITICAL INIT ERROR:', err);
        // Alert the user so they can see if it's a specific JS error
        // alert('Initialization Error: ' + err.message);
    }

    // Refresh active time every minute
    setInterval(updateActiveTime, 60000);

    // BACKGROUND SYNC: Refresh the ride list every 10 seconds as a fallback
    setInterval(() => {
        if (currentUser && currentStatus === 'online') {
            checkContextAndLoad();
        }
    }, 10000);
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
        // Clear passenger markers when no requests
        clearAllMarkers();
        if (currentDriverLat && currentDriverLng) {
            addDriverMarker(currentUser.id, currentDriverLat, currentDriverLng, 'You');
        }
        return;
    }

    container.innerHTML = '';

    // Clear existing markers and re-add driver
    clearAllMarkers();
    if (currentDriverLat && currentDriverLng) {
        addDriverMarker(currentUser.id, currentDriverLat, currentDriverLng, 'You');
    }

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

        // Add passenger marker with Accept button on popup
        if (ride.pickup_lat && ride.pickup_lng) {
            addRideRequestMarker(ride, passengerName);
        }
    });

    // Fit map to show all markers (driver + passengers)
    fitBounds();
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
    if (currentNavRideId !== ride.ride_id) {
        showNavigationRoute(ride);
    }
}

async function loadEarnings() {
    try {
        const stats = await DriverService.getDailyEarnings(currentUser.id);
        const tripsEl = document.getElementById('total-trips');
        const earningsEl = document.getElementById('total-earnings');
        const todayEarnEl = document.getElementById('modal-today-earn');
        const modalTotalTrips = document.getElementById('modal-total-trips');

        if (tripsEl) tripsEl.innerText = stats.count;
        if (earningsEl) earningsEl.innerText = `₱${stats.total.toLocaleString()}`;
        if (todayEarnEl) todayEarnEl.innerText = `₱${stats.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        if (modalTotalTrips) modalTotalTrips.innerText = stats.count;

        // Load History List
        const history = await DriverService.getRecentHistory(currentUser.id);
        const container = document.getElementById('earnings-trip-history');
        if (container) {
            if (history.length > 0) {
                container.innerHTML = history.map(t => `
                    <div style="background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${t.dropoff_location}</div>
                            <div style="font-size: 11px; color: #64748b;">${new Date(t.request_time).toLocaleDateString()}</div>
                        </div>
                        <div style="font-weight: 700; color: #10b981;">+₱${parseFloat(t.price).toFixed(2)}</div>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">No recent trips recorded.</p>';
            }
        }
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

async function initDriverMap() {
    // Reset to ensure we always target the correct container
    if (driverMap) return driverMap;

    const container = document.getElementById('driver-map');
    if (!container) return;

    console.log('📍 Initializing Driver Home Map...');

    const defaultLat = 9.3068;
    const defaultLng = 123.3033;
    let startLat = currentDriverLat || defaultLat;
    let startLng = currentDriverLng || defaultLng;

    // Init map IMMEDIATELY for speed
    driverMap = initMap('driver-map', { lat: startLat, lng: startLng }, 15);

    // Add immediate self marker
    const userIcon = `<div class="user-location-marker"></div>`;
    addMarker(`driver-${currentUser.id}`, startLat, startLng, {
        icon: userIcon,
        title: "You",
        popup: "Your Current Position"
    });

    // Start background tracking if not already
    startTrackingLocation();

    // Refine location immediately
    getCurrentPosition().then(pos => {
        if (pos) {
            currentDriverLat = pos.lat;
            currentDriverLng = pos.lng;
            updateMarkerPosition(`driver-${currentUser.id}`, pos.lat, pos.lng);
            centerMap(pos.lat, pos.lng);
        }
    }).catch(err => console.warn('Fast init GPS error:', err));

    return driverMap;
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

        // REAL-TIME NAVIGATION: If we are currently in a ride, update the route line
        // FAST: Uses already loaded ride object to avoid DB hits on every GPS tick
        if (currentNavRideId && activeNavRide && !isUpdatingNav) {
            // Check distance moved to throttle redraws (every 10 meters)
            let dist = 100;
            if (lastNavUpdatePos) {
                dist = calculateDistance(pos.lat, pos.lng, lastNavUpdatePos.lat, lastNavUpdatePos.lng) * 1000;
            }

            if (dist > 10) {
                isUpdatingNav = true;
                showNavigationRoute(activeNavRide).finally(() => {
                    isUpdatingNav = false;
                    lastNavUpdatePos = { lat: pos.lat, lng: pos.lng };
                });
            }
        }
    });
}

async function showNavigationRoute(ride) {
    if (!driverMap) return;
    currentNavRideId = ride.ride_id;
    activeNavRide = ride; // Store for real-time tracking

    // Sync current GPS coord if we have it
    const startLat = currentDriverLat || ride.driver_lat || 9.3068;
    const startLng = currentDriverLng || ride.driver_lng || 123.3033;

    if (startLat && startLng) {
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`driver-${currentUser.id}`, currentDriverLat, currentDriverLng, {
            icon: userIcon,
            title: "You",
            popup: "Your Current Position"
        });

        const points = [{ lat: startLat, lng: startLng }];
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

window.triggerEmergency = async (rideId) => {
    if (!await showConfirm("🚨 ACTIVATE EMERGENCY SOS? This will alert TMO and local authorities immediately.")) return;
    try {
        await RideService.declineRide(rideId, currentUser.id);
        checkContextAndLoad();
    } catch (e) {
        console.error(e);
    }
};

window.declineRide = async (rideId) => {
    if (!await showConfirm('Ignore this request?')) return;
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
    if (await showConfirm('Are you sure you want to logout?')) {
        await supabaseClient.auth.signOut();
        window.location.href = 'signin.html';
    }
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

window.openNotifications = async () => {
    document.getElementById('notifOverlay').style.display = 'flex';
    document.getElementById('notif-dot').style.display = 'none';

    const container = document.getElementById('notif-list');
    if (!container) return;

    try {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Loading messages...</p>';
        const alerts = await DriverService.getSystemAlerts();

        if (alerts.length > 0) {
            container.innerHTML = alerts.map(a => `
                <div style="background: ${a.type === 'broadcast' ? '#fff7ed' : '#f8fafc'}; padding: 15px; border-radius: 12px; border-left: 4px solid ${a.type === 'broadcast' ? '#f97316' : '#e2e8f0'};">
                    <h4 style="font-size: 14px; color: ${a.type === 'broadcast' ? '#9a3412' : 'var(--text-main)'}; margin-bottom: 4px;">${a.title || 'System Message'}</h4>
                    <p style="font-size: 12px; color: ${a.type === 'broadcast' ? '#7c2d12' : 'var(--text-muted)'}; line-height: 1.4;">${a.message}</p>
                    <span style="font-size: 10px; opacity: 0.7; margin-top: 8px; display: block;">${new Date(a.created_at).toLocaleString()}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">No messages from TMO yet.</p>';
        }
    } catch (e) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Failed to load messages.</p>';
    }
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

        await showAlert('Profile updated!', 'success');
        location.reload();
    } catch (e) {
        await showAlert('Error: ' + e.message, 'error');
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

    // Hide all overlays first
    const overlays = ['profileOverlay', 'earningsOverlay', 'editProfileOverlay'];
    overlays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Remove active class from all tabs
    [navHome, navMap, navHistory, navProfile].forEach(el => {
        if (el) el.classList.remove('active');
    });

    // Reset active map ref to force re-init on new tab container
    if (tab === 'home' || tab === 'map') {
        driverMap = null;
    }

    if (tab === 'home' && homeView) {
        if (mapView) mapView.classList.remove('active');
        homeView.classList.add('active');
        if (navHome) navHome.classList.add('active');
        checkContextAndLoad();
        initDriverMap(); // Re-init home map
    } else if (tab === 'map' && mapView) {
        if (homeView) homeView.classList.remove('active');
        mapView.classList.add('active');
        if (navMap) navMap.classList.add('active');
        setTimeout(initExplorationMap, 100);
    } else if (tab === 'history') {
        if (navHistory) navHistory.classList.add('active');
        document.getElementById('earningsOverlay').style.display = 'flex';
        loadEarnings();
    } else if (tab === 'profile') {
        if (navProfile) navProfile.classList.add('active');
        document.getElementById('profileOverlay').style.display = 'flex';
    }
};

async function initExplorationMap() {
    console.log('📍 Initializing Driver Exploration Map...');
    const lat = currentDriverLat || 9.3068;
    const lng = currentDriverLng || 123.3033;

    // 1. Init Map Instantly
    driverMap = initMap('exploration-map', { lat, lng }, 14);

    // 2. Add immediate self marker
    const userIcon = `<div class="user-location-marker"></div>`;
    addMarker(`driver-${currentUser.id}`, lat, lng, {
        icon: userIcon,
        title: "You",
        popup: "Your Position"
    });

    // 3. Refine GPS in background
    getCurrentPosition().then(pos => {
        if (pos) {
            currentDriverLat = pos.lat;
            currentDriverLng = pos.lng;
            updateMarkerPosition(`driver-${currentUser.id}`, pos.lat, pos.lng);
            centerMap(pos.lat, pos.lng);
        }
    }).catch(console.warn);

    // 4. Fetch Requests & Active Trip
    try {
        const activeRide = await RideService.fetchActiveRide(currentUser.id);
        if (activeRide) {
            showNavigationRoute(activeRide);
        }

        const rides = await RideService.fetchPendingRides(currentUser.id);
        rides.forEach(r => {
            if (activeRide && r.ride_id === activeRide.ride_id) return;
            if (r.pickup_lat) {
                const passengerName = r.passenger?.fullname || 'Passenger';
                addRideRequestMarker(r, passengerName);
            }
        });
    } catch (e) {
        console.error('Exploration data load error:', e);
    }
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
