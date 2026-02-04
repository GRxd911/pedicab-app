
import { initAudio, playNotificationSound, playAlertSound } from '../services/audio.js';
import { updateAvatarUI, updateStatusUI, previewAvatar, applyTheme, activateSOSUI } from '../utils/ui.js';
import * as DriverService from '../services/driver.js';
import * as RideService from '../services/rides.js';
import { supabaseClient } from '../services/config.js'; // Needed for direct auth checks if any

// State
let currentUser = null;
let currentStatus = 'offline';
let lastStatusChange = null;
let pendingAcceptRideId = null;
let verificationStatus = 'pending';

// --- INITIALIZATION ---
async function init() {
    // Check Session
    const session = await DriverService.getSession();
    if (!session) {
        window.location.href = 'signin.html';
        return;
    }

    currentUser = session.user;

    // UI Setup
    document.getElementById('driver-name').innerText = currentUser.user_metadata.full_name || 'Driver Partner';
    document.getElementById('disp-name').innerText = currentUser.user_metadata.full_name || 'Driver Partner';
    document.getElementById('disp-email').innerText = currentUser.email;
    updateAvatarUI(currentUser.user_metadata.avatar_url);

    // Apply Background Color
    applyTheme(currentUser.user_metadata.preferred_color);

    // Fetch Status
    const driverData = await DriverService.getDriverProfile(currentUser.id);
    if (driverData) {
        document.getElementById('driver-plate').innerText = `Pedicab #${driverData.pedicab_plate}`;
        document.getElementById('disp-plate').innerText = driverData.pedicab_plate;

        currentStatus = driverData.status || 'offline';
        lastStatusChange = driverData.last_status_change;
        verificationStatus = driverData.verification_status || 'pending';

        // Notify Service
        RideService.setRideServiceStatus(currentStatus);

        updateStatusUI(currentStatus);
        updateActiveTime();
        loadEarnings();

        // Listeners
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
        document.getElementById('driver-plate').innerText = 'No Plate Assigned';
        updateStatusUI('offline');
    }

    // Audio Unlock
    ['click', 'touchstart', 'mousedown'].forEach(evt => {
        document.addEventListener(evt, initAudio);
    });

    // Clock
    setInterval(updateActiveTime, 60000);
}

// --- CORE FUNCTIONS ---

async function checkContextAndLoad() {
    if (!currentUser) return;
    try {
        // 1. Check if active ride
        const activeRide = await RideService.fetchActiveRide(currentUser.id);
        if (activeRide) {
            showActiveRideUI(activeRide);
        } else {
            // 2. Otherwise load pending
            const pendingRides = await RideService.fetchPendingRides(currentUser.id);
            renderPendingRides(pendingRides);
        }
    } catch (e) {
        console.error('Context load error:', e);
    }
}

async function renderPendingRides(rides) {
    if (currentStatus !== 'online') return;

    // Safety check: don't overwrite if active trip exists in DOM (double check)
    if (document.querySelector('.active-trip')) return;

    const container = document.getElementById('ride-request-container');

    if (rides.length === 0) {
        container.innerHTML = `
            <div id="waiting-msg" style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px; background: white; margin: 0 20px 20px; border-radius: 24px;">
                Searching for passenger requests...
            </div>`;
        return;
    }

    container.innerHTML = '';

    rides.forEach(ride => {
        // Robust data extraction
        const userData = ride.users || ride.passenger;
        const passenger = Array.isArray(userData) ? userData[0] : userData;
        const passengerName = passenger?.fullname || 'Passenger';
        const avatarUrl = passenger?.avatar_url;

        // Null-safe location strings
        const pickup = (ride.pickup_location || 'Unknown').replace(/'/g, "\\'");
        const dropoff = (ride.dropoff_location || 'Unknown').replace(/'/g, "\\'");

        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover;">`
            : `<i class='bx bxs-user'></i>`;

        const card = document.createElement('div');
        card.className = 'request-notification';
        card.dataset.id = ride.ride_id;
        card.innerHTML = `
            <div class="notification-header">
                <span class="tag-new">NEW REQUEST</span>
                <span style="font-size: 12px; font-weight: 700; color: var(--secondary);">N/A</span>
            </div>
            <div class="req-details">
                <div class="req-avatar" style="overflow: hidden; display: flex; align-items: center; justify-content: center;">
                    ${avatarHtml}
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
}

async function loadEarnings() {
    const stats = await DriverService.getDailyEarnings(currentUser.id);
    document.getElementById('total-trips').innerText = stats.count;
    document.getElementById('total-earnings').innerText = `₱${stats.total.toLocaleString()}`;

    if (document.getElementById('modal-today-earn')) {
        document.getElementById('modal-today-earn').innerText = `₱${stats.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    }
}

function updateActiveTime() {
    if (currentStatus !== 'online' || !lastStatusChange) {
        document.getElementById('active-hours').innerText = '0h 0m';
        document.getElementById('fatigue-warning').style.display = 'none';
        return;
    }

    const start = new Date(lastStatusChange);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    document.getElementById('active-hours').innerText = `${hours}h ${mins}m`;

    const warning = document.getElementById('fatigue-warning');
    if (hours >= 4) {
        warning.style.display = 'flex';
        document.getElementById('active-duration-msg').innerText = `${hours} hours and ${mins} minutes`;
    } else {
        warning.style.display = 'none';
    }
}

// --- GLOBAL EXPORTS (For HTML onclick) ---

window.toggleStatus = async () => {
    const btn = document.getElementById('online-toggle');
    const isGoingOnline = btn.innerText === 'Go Online';
    const newStatus = isGoingOnline ? 'online' : 'offline';

    btn.innerText = 'Updating...';
    btn.style.pointerEvents = 'none';

    try {
        if (isGoingOnline && verificationStatus !== 'verified') {
            alert('Your account is not yet verified by TMO. Please wait for verification before going online.');
            btn.innerText = 'Go Online';
            return;
        }

        await DriverService.toggleDriverStatus(currentUser.id, newStatus);

        currentStatus = newStatus;
        lastStatusChange = new Date().toISOString();
        RideService.setRideServiceStatus(currentStatus);

        updateStatusUI(newStatus);
        updateActiveTime();

        if (newStatus === 'online') {
            playNotificationSound(true);
            checkContextAndLoad();
        }
    } catch (e) {
        alert('Status update failed: ' + e.message);
        updateStatusUI(isGoingOnline ? 'offline' : 'online');
    } finally {
        btn.style.pointerEvents = 'auto';
    }
};

window.acceptRide = async (rideId, pickup, dropoff) => {
    try {
        await RideService.acceptRide(rideId, currentUser.id);
        alert('Ride Accepted! Safe travels.');
        // UI update implicitly handled via listener, but fast UI update here:
        showActiveRideUI({ ride_id: rideId, pickup_location: pickup, dropoff_location: dropoff });
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

window.declineRide = async (rideId) => {
    if (!confirm('Hide this request?')) return;
    try {
        await RideService.declineRide(rideId, currentUser.id);
        checkContextAndLoad();
    } catch (e) {
        alert('Error: ' + e.message);
    }
};

window.openCompleteOverlay = (rideId, pickup, dropoff) => {
    pendingAcceptRideId = rideId;
    document.getElementById('custom-fare').value = '';
    document.getElementById('fare-pickup').innerText = pickup;
    document.getElementById('fare-dropoff').innerText = dropoff;
    document.getElementById('fareOverlay').style.display = 'flex';
};

window.setFareField = (amount) => {
    document.getElementById('custom-fare').value = amount;
};

window.submitFare = async () => {
    const fareValue = document.getElementById('custom-fare').value;
    if (!fareValue || fareValue <= 0) {
        alert('Please enter a valid fare amount.');
        return;
    }

    document.getElementById('confirm-fare-btn').innerText = 'Completing...';
    try {
        await RideService.completeTrip(pendingAcceptRideId, fareValue);
        document.getElementById('fareOverlay').style.display = 'none';
        alert('Success! Trip completed.');
        location.reload(); // Simplest way to reset state
    } catch (e) {
        alert('Error: ' + e.message);
        document.getElementById('confirm-fare-btn').innerText = 'Complete Trip';
    }
};

window.logout = async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'signin.html';
};

// Profile & Misc Globals
window.openEditProfile = () => document.getElementById('editProfileOverlay').style.display = 'flex';
window.closeProfile = (e) => {
    if (e.target.id === 'profileOverlay') document.getElementById('profileOverlay').style.display = 'none';
};
window.closeEditProfile = (e) => {
    if (e.target.id === 'editProfileOverlay' || e.target.classList.contains('bx-x')) document.getElementById('editProfileOverlay').style.display = 'none';
};
window.previewAvatar = (el) => previewAvatar(el); // Re-export util

// Setup Profile Tab Click
document.getElementById('profileTab').onclick = () => {
    document.getElementById('profileOverlay').style.display = 'flex';
};
document.getElementById('earningsTab').onclick = async () => {
    document.getElementById('earningsOverlay').style.display = 'flex';
    // Load history
    const history = await DriverService.getRecentHistory(currentUser.id);
    const container = document.getElementById('earnings-trip-history');
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
    }
};



// Notifications & Alerts
async function loadNotifications() {
    const { data: alerts, error } = await supabaseClient
        .from('system_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) return;

    const list = document.getElementById('notif-list');
    if (alerts && alerts.length > 0) {
        list.innerHTML = alerts.map(a => {
            let bgColor = '#f8fafc';
            let borderColor = '#e2e8f0';
            let textColor = 'var(--text-main)';

            if (a.type === 'warning') {
                bgColor = '#fffbeb';
                borderColor = '#f59e0b';
            } else if (a.type === 'danger') {
                bgColor = '#fff1f2';
                borderColor = '#ef4444';
            }

            return `
                <div style="background: ${bgColor}; padding: 15px; border-radius: 12px; border-left: 4px solid ${borderColor};">
                    <h4 style="font-size: 14px; color: ${textColor}; margin-bottom: 4px;">${a.title}</h4>
                    <p style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">${a.message}</p>
                    <span style="font-size: 10px; color: var(--text-muted); opacity: 0.7; margin-top: 8px; display: block;">${new Date(a.created_at).toLocaleString()}</span>
                </div>
            `;
        }).join('');
    } else {
        list.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">No new alerts from TMO.</p>';
    }
}

function setupAlertListener() {
    supabaseClient
        .channel(`system-alerts-${currentUser.id}`)
        .on('postgres_changes', { event: 'INSERT', table: 'system_alerts' }, payload => {
            loadNotifications();
            playAlertSound();
            document.getElementById('notif-dot').style.display = 'block';
        })
        .subscribe();
}

function setupStatusListener() {
    supabaseClient
        .channel(`driver-status-${currentUser.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            table: 'drivers',
            filter: `driver_id=eq.${currentUser.id}`
        }, payload => {
            const newStatus = payload.new.status;
            // Also sync verification status
            verificationStatus = payload.new.verification_status || 'pending';

            // Only update if it's actually different (isolates from other users)
            if (newStatus !== currentStatus) {
                currentStatus = newStatus;
                lastStatusChange = payload.new.last_status_change;
                RideService.setRideServiceStatus(currentStatus);
                updateStatusUI(currentStatus);
                updateActiveTime();
            }
        })
        .subscribe();
}

function setupEmergencyListener() {
    console.log('🚨 Setting up emergency listener for driver:', currentUser.id);

    const channel = supabaseClient
        .channel('global-emergencies')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'emergencies',
            filter: 'status=eq.active'
        }, payload => {
            console.log('🚨 EMERGENCY DETECTED:', payload);
            console.log('Emergency data:', payload.new);
            activateSOSUI(true); // true = isDriver
            playAlertSound();
        })
        .subscribe((status) => {
            console.log('Emergency channel status:', status);
            if (status === 'SUBSCRIBED') {
                console.log('✅ Emergency listener is active and waiting for SOS signals');
            }
        });
}

// Chat UI
let chatRideId = null;
let chatInterval = null;

window.openChat = (rideId, passengerName) => {
    chatRideId = rideId;
    document.getElementById('chat-passenger-name').innerText = passengerName || 'Passenger';
    document.getElementById('chatOverlay').style.display = 'flex';
    loadChatMessages();
    chatInterval = setInterval(loadChatMessages, 3000);
};

window.closeChat = () => {
    document.getElementById('chatOverlay').style.display = 'none';
    if (chatInterval) clearInterval(chatInterval);
    chatRideId = null;
};

async function loadChatMessages() {
    if (!chatRideId) return;
    const msgs = await RideService.fetchChatMessages(chatRideId);

    const container = document.getElementById('chat-messages');
    container.innerHTML = msgs.map(m => {
        const isMine = m.sender_id === currentUser.id;
        const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
                ${m.content}
                <div class="chat-time" style="color: ${isMine ? 'rgba(255,255,255,0.8)' : '#94a3b8'}">${time}</div>
            </div>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

window.sendChat = async () => {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content || !chatRideId) return;

    input.value = ''; // Optimistic clear
    await RideService.sendChatMessage(chatRideId, currentUser.id, content);
    loadChatMessages();
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
        let avatarUrl = currentUser.user_metadata.avatar_url;

        // 1. Upload new avatar if present
        if (avatarFile) {
            avatarUrl = await DriverService.uploadAvatar(currentUser.id, avatarFile);
        }

        // 2. Update Profile & Auth (Uses the DriverService we added earlier) -> wait, DriverService.updateProfile doesn't handle avatar!
        // We need to update user metadata with avatar_url manually or update DriverService to accept it.
        // Let's do it manually here to be safe, or assume DriverService handles it?
        // DriverService.updateProfile only takes name/phone. 
        // I should have updated DriverService.updateProfile to take avatarUrl.
        // I will do the calls manually here for safety since I can't easily edit DriverService again without risk.

        // Update Auth Metadata including Avatar
        const { error: authError } = await supabaseClient.auth.updateUser({
            data: {
                full_name: name,
                avatar_url: avatarUrl,
                preferred_color: color
            }
        });
        if (authError) throw authError;

        // Update Public Users Table
        const { error: dbError } = await supabaseClient
            .from('users')
            .update({
                fullname: name,
                phone: phone,
                avatar_url: avatarUrl,
                preferred_color: color
            })
            .eq('id', currentUser.id);

        if (dbError) throw dbError;

        alert('Profile updated!');
        location.reload();
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText = 'Save Changes';
        btn.disabled = false;
    }
};

document.getElementById('notif-bell').onclick = () => {
    document.getElementById('notifOverlay').style.display = 'flex';
    document.getElementById('notif-dot').style.display = 'none';
    loadNotifications();
};

// Open Edit Profile - populate fields
const originalOpenEdit = window.openEditProfile;
window.openEditProfile = async () => {
    originalOpenEdit();
    // Populate
    document.getElementById('edit-fullname').value = currentUser.user_metadata.full_name || '';
    document.getElementById('edit-phone').value = currentUser.user_metadata.phone || ''; // Can't easily get from metadata if not sync'd, try DOM
    document.getElementById('edit-color').value = currentUser.user_metadata.preferred_color || '#2563eb';
}

// --- MAP INTEGRATION ---
import { initMap, addDriverMarker, addPassengerMarker, addDestinationMarker, drawRoute, drawMultiPointRoute, fitBounds, centerMap, updateMarkerPosition, clearAllMarkers, clearRoute, addSOSMarker } from '../utils/map.js';
import { getCurrentPosition, geocodeAddress, watchPosition, stopWatchingPosition, updateDriverLocation, calculateDistance } from '../services/location.js';

let driverMap = null;
let locationWatchId = null;
let currentDriverLat = null;
let currentDriverLng = null;

// Initialize Driver Map
function initDriverMap() {
    if (driverMap) return;

    getCurrentPosition().then(pos => {
        currentDriverLat = pos.lat;
        currentDriverLng = pos.lng;

        driverMap = initMap('driver-map', { lat: pos.lat, lng: pos.lng });

        // Add pulsating self marker
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`driver-${currentUser.id}`, pos.lat, pos.lng, {
            icon: userIcon,
            title: "You",
            popup: "Your Current Position"
        });

        // Start tracking location
        startTrackingLocation();
    });
}

// Track real-time location and update specific DB column
function startTrackingLocation() {
    if (locationWatchId) return;

    locationWatchId = watchPosition(async (pos) => {
        currentDriverLat = pos.lat;
        currentDriverLng = pos.lng;

        // Update local map marker smoothly
        if (driverMap) {
            updateMarkerPosition(`driver-${currentUser.id}`, pos.lat, pos.lng);
        }

        // Update database
        try {
            if (currentStatus === 'online') {
                await updateDriverLocation(currentUser.id, pos.lat, pos.lng);
            }
        } catch (err) {
            console.error('Location update failed', err);
        }
    });
}

// Show route for active ride
async function showNavigationRoute(pickup, dropoff) {
    if (!driverMap) {
        // Wait for map init
        await new Promise(r => setTimeout(r, 1000));
        if (!driverMap) initDriverMap();
    }

    clearAllMarkers();
    clearRoute();

    // Add current location
    addDriverMarker(currentUser.id, currentDriverLat, currentDriverLng, "You");

    // Geocode pickup/dropoff (simplified, ideally usage of lat/lng from ride DB)
    const p = await geocodeAddress(pickup);
    const d = await geocodeAddress(dropoff);

    if (p) addPassengerMarker('pickup', p.lat, p.lng, `Pickup: ${pickup}`);
    if (d) addDestinationMarker(d.lat, d.lng, `Dropoff: ${dropoff}`);

    if (p && d && currentDriverLat && currentDriverLng) {
        // Draw route: Driver -> Pickup -> Dropoff
        drawMultiPointRoute([
            { lat: currentDriverLat, lng: currentDriverLng },
            { lat: p.lat, lng: p.lng },
            { lat: d.lat, lng: d.lng }
        ], {
            onRouteFound: (summary) => {
                // Could update UI with distance/ETA here
                console.log(`Route Found: ${summary.distance}km, ${summary.duration}min`);
            }
        });

        // Auto-zoom
        fitBounds();
    }
}

// Modify showActiveRideUI to show map route
const originalShowActiveRideUI = showActiveRideUI;
showActiveRideUI = function (ride) {
    originalShowActiveRideUI(ride);

    // Trigger map update
    showNavigationRoute(ride.pickup_location, ride.dropoff_location);

    // Ensure map container is visible
    const mapDiv = document.getElementById('driver-map');
    if (mapDiv) mapDiv.style.display = 'block';
};

// Start map on init
setTimeout(initDriverMap, 2000);

// START
init();
