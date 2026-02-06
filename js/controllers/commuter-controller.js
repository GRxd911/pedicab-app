
import { supabaseClient } from '../services/config.js';
import * as CommuterAuth from '../services/commuter-auth.js';
import * as CommuterRides from '../services/commuter-rides.js';
import * as CommuterProfile from '../services/commuter-profile.js';
import * as CommuterChat from '../services/commuter-chat.js';
import * as AudioService from '../services/audio.js';
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
    removeMarker,
    clearAllMarkers,
    clearRoute
} from '../utils/map.js';
import {
    getCurrentPosition,
    geocodeAddress,
    getAddressSuggestions,
    reverseGeocode,
    watchPosition,
    stopWatchingPosition,
    calculateDistance
} from '../services/location.js';
import { applyTheme, activateSOSUI, showConfirm } from '../utils/ui.js';

// State
let currentUser = null;
let currentRating = 0;
let chatRideId = null;
let chatInterval = null;
let lastRideStatus = null;
let detectedAddressString = null;
let selectedPickupCoords = null;
let selectedDropoffCoords = null;
let manualDropoffAddress = null;
let manualPickupAddress = null;

// DOM Elements
const elements = {
    bookingStatusContainer: document.getElementById('booking-status-container'),
    requestFormContainer: document.getElementById('request-form-container'),
    profileOverlay: document.getElementById('profileOverlay'),
    historyOverlay: document.getElementById('historyOverlay'),
    emergencyContactOverlay: document.getElementById('emergencyContactOverlay'),
    editProfileOverlay: document.getElementById('editProfileOverlay'),
    chatOverlay: document.getElementById('chatOverlay'),
    pickupInput: document.getElementById('pickup-input'),
    dropoffInput: document.getElementById('dropoff-input'),
    requestBtn: document.getElementById('request-btn'),
    dispName: document.getElementById('disp-name'),
    dispEmail: document.getElementById('disp-email'),
    profileBtn: document.getElementById('profile-btn'),
    cityAlertBanner: document.getElementById('city-alert-banner'),
    pickupSuggestions: document.getElementById('pickup-suggestions'),
    dropoffSuggestions: document.getElementById('dropoff-suggestions'),
    alertText: document.getElementById('alert-text'),
    notifDot: document.getElementById('notif-dot'),
    mobileLayout: document.getElementById('mobile-layout-container')
};

// --- INITIALIZATION ---
async function init() {
    const session = await CommuterAuth.checkPassengerSession();
    if (!session) {
        window.location.href = 'signin.html';
        return;
    }
    currentUser = session.user;

    const lastUserId = localStorage.getItem('last_passenger_id');
    if (lastUserId !== currentUser.id) {
        sessionStorage.clear();
        localStorage.setItem('last_passenger_id', currentUser.id);
    }

    // Set UI with user data
    elements.dispName.innerText = currentUser.user_metadata.full_name || 'Passenger';
    elements.dispEmail.innerText = currentUser.email;
    updateAvatarUI(currentUser.user_metadata.avatar_url);

    // Apply Background Color
    applyTheme(currentUser.user_metadata.preferred_color);

    // Initial Load
    await refreshAllData();
    setupListeners();

    // Auto-fill pickup location
    autoLocateUser();

    // Polling fallbacks
    setInterval(() => CommuterRides.fetchAvailableDrivers().then(updateAvailableDriversUI), 15000);
    setInterval(() => checkActiveRide(), 5000);

    // Global audio init on interaction
    ['click', 'touchstart', 'mousedown'].forEach(evt => {
        document.addEventListener(evt, () => AudioService.initAudio(), { once: true });
    });
}

async function refreshAllData() {
    if (!currentUser) return;
    await checkActiveRide();
    await loadProfileStats();
    await CommuterRides.fetchAvailableDrivers().then(updateAvailableDriversUI);
    await CommuterRides.fetchTripHistory(currentUser.id).then(updateTripHistoryUI);
    await loadSuggestions();
}

function setupListeners() {
    if (!currentUser) return;

    // UI Click Listeners
    if (elements.requestBtn) {
        elements.requestBtn.addEventListener('click', window.requestRide);
    }
    if (elements.profileBtn) {
        elements.profileBtn.addEventListener('click', () => {
            const header = document.querySelector('.app-header');
            if (header) header.style.display = 'none';
            elements.profileOverlay.style.display = 'flex';
        });
    }
    const navProfile = document.getElementById('nav-profile');
    // Switched to HTML onclick for switchTab consistency

    // Navbar Switching handled via HTML onclick

    // Ride updates - Unique channel per passenger
    supabaseClient
        .channel(`passenger-ride-updates-${currentUser.id}`)
        .on('postgres_changes', {
            event: '*',
            table: 'rides',
            filter: `passenger_id=eq.${currentUser.id}`
        }, async payload => {
            const newStatus = payload.new?.status;

            if (lastRideStatus === 'pending' && newStatus === 'accepted') {
                AudioService.playMatchSound();
            } else if (payload.eventType === 'UPDATE' && newStatus === 'completed') {
                AudioService.playCompleteSound();
                await checkActiveRide(true);
                await CommuterRides.fetchTripHistory(currentUser.id).then(updateTripHistoryUI);
                return;
            }

            lastRideStatus = newStatus;
            await checkActiveRide();
            await CommuterRides.fetchTripHistory(currentUser.id).then(updateTripHistoryUI);
        })
        .subscribe();

    // City alerts - unique channel
    supabaseClient
        .channel(`city-alerts-${currentUser.id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            table: 'system_alerts'
        }, payload => {
            showCityAlert(payload.new.message);
        })
        .subscribe();

    // Autocomplete for Pick-up and Drop-off
    setupAutocomplete(elements.pickupInput, elements.pickupSuggestions, 'pickup');
    setupAutocomplete(elements.dropoffInput, elements.dropoffSuggestions, 'dropoff');
}

// --- RIDE MANAGEMENT ---

async function checkActiveRide(forceShowCompleted = false) {
    if (!currentUser) return;

    try {
        const ride = await CommuterRides.fetchActiveRide(currentUser.id);

        if (!ride) {
            // Stop tracking since no active ride
            stopTrackingDriver();

            // Check for recently completed to show rating
            const completed = await CommuterRides.fetchLastCompletedRide(currentUser.id);
            if (completed && completed.rating === null) {
                // Prevent duplicate showing if already on screen
                if (elements.bookingStatusContainer.style.display === 'block' && elements.bookingStatusContainer.innerHTML.includes('Trip Complete!')) {
                    return;
                }
                showCompletionUI(completed);
                return;
            }

            elements.bookingStatusContainer.style.display = 'none';
            elements.requestFormContainer.style.display = 'block';
            return;
        }

        elements.requestFormContainer.style.display = 'none';
        elements.bookingStatusContainer.style.display = 'block';

        if (ride.status === 'pending' || !ride.driver_id) {
            updatePendingUI(ride);
            stopTrackingDriver(); // No driver yet

            // Still show the map with pickup/dropoff
            const mContainer = document.getElementById('tracking-map-container');
            if (mContainer) mContainer.style.display = 'block';
            await initPassengerMap();
            setupRideMap(ride);
        } else {
            const driverDetails = await CommuterRides.fetchDriverDetails(ride.driver_id);
            updateAcceptedUI(ride, driverDetails);

            // Start tracking map
            startTrackingDriver(ride.driver_id, ride);
        }

    } catch (err) {
        console.error('Error in checkActiveRide:', err);
    }
}

// Start tracking driver during active ride
async function startTrackingDriver(driverId, ride) {
    console.log('🚀 Starting Real-time tracking for driver:', driverId);

    // Show map container
    const mapContainer = document.getElementById('tracking-map-container');
    if (mapContainer) mapContainer.style.display = 'block';

    // Init map if needed
    await initPassengerMap();

    // Initial map setup
    setupRideMap(ride);

    // REAL-TIME: Watch USER location (Blue Dot)
    if (locationWatchId) stopWatchingPosition(locationWatchId);

    locationWatchId = watchPosition((pos) => {
        currentPassengerLat = pos.lat;
        currentPassengerLng = pos.lng;

        // Move "You" marker (upsert)
        if (passengerMap) {
            const userIcon = `<div class="user-location-marker"></div>`;
            updateMarkerPosition(`passenger-${currentUser.id}`, pos.lat, pos.lng, userIcon);
        }
    });

    // REAL-TIME: Listen for driver location changes
    if (driverLocationInterval) {
        // Unsubscribe if exists (clean up)
        supabaseClient.removeChannel(driverLocationInterval);
    }

    driverLocationInterval = supabaseClient
        .channel(`driver-tracking-${driverId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            table: 'drivers',
            filter: `driver_id=eq.${driverId}`
        }, payload => {
            console.log('📍 Real-time location update:', payload.new);
            handleLocationUpdate(payload.new);
        })
        .subscribe();
}

async function setupRideMap(ride) {
    if (!passengerMap) {
        console.warn("setupRideMap: Map not ready yet");
        // Try to recover
        await initPassengerMap();
        if (!passengerMap) return;
    }

    console.log("📍 Syncing Ride Map Markers for ride:", ride.ride_id);
    clearAllMarkers();
    clearRoute();

    let markerFound = false;

    // 1. Add Exact Pickup
    if (ride.pickup_lat && ride.pickup_lng) {
        addPassengerMarker('pickup-point', ride.pickup_lat, ride.pickup_lng, ride.pickup_location);
        markerFound = true;
    }

    // 2. Add Exact Dropoff
    if (ride.dropoff_lat && ride.dropoff_lng) {
        addDestinationMarker(ride.dropoff_lat, ride.dropoff_lng, ride.dropoff_location);
        markerFound = true;
    }

    // 3. Add User Marker (If we have it)
    if (currentPassengerLat && currentPassengerLng) {
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`passenger-${currentUser.id}`, currentPassengerLat, currentPassengerLng, {
            icon: userIcon,
            title: "You",
            popup: "Your Current Position"
        });
        markerFound = true;
    }

    // 4. Add Driver
    if (ride.driver_id) {
        // Fetch driver data in background, don't await to avoid blocking UI
        supabaseClient
            .from('drivers')
            .select('*, users(fullname)')
            .eq('driver_id', ride.driver_id)
            .single()
            .then(({ data: driverData }) => {
                if (driverData && driverData.current_lat && driverData.current_lng) {
                    addDriverMarker(ride.driver_id, driverData.current_lat, driverData.current_lng, driverData.users?.fullname || 'Driver');
                    handleLocationUpdate(driverData);
                    fitBounds(); // Re-fit once driver is found
                }
            }).catch(console.error);
    }

    if (markerFound) {
        fitBounds();
    }
}

async function handleLocationUpdate(driverData) {
    if (!driverData.current_lat || !driverData.current_lng) return;

    // Update driver marker smoothly (upsert)
    const driverIcon = `
        <div class="driver-marker-premium">
            <div class="marker-halo"></div>
            <div class="marker-core">
                <i class='bx bxs-car'></i>
            </div>
        </div>
    `;
    updateMarkerPosition(`driver-${driverData.driver_id}`, driverData.current_lat, driverData.current_lng, driverIcon);

    // Keep both in view
    fitBounds();

    // If we have passenger location, update stats
    if (currentPassengerLat && currentPassengerLng) {
        const dist = calculateDistance(
            currentPassengerLat, currentPassengerLng,
            driverData.current_lat, driverData.current_lng
        );

        // Update UI stats
        const distEl = document.getElementById('tracking-distance');
        const etaEl = document.getElementById('tracking-eta');

        if (distEl) distEl.innerText = `${dist.toFixed(2)} km`;
        if (etaEl) {
            const eta = Math.ceil(dist * 6); // 6 mins per km
            etaEl.innerText = eta < 1 ? 'Less than 1 min' : `${eta} mins`;
        }
    }
}

function stopTrackingDriver() {
    if (driverLocationInterval) {
        if (typeof driverLocationInterval === 'number') {
            clearInterval(driverLocationInterval);
        } else {
            supabaseClient.removeChannel(driverLocationInterval);
        }
        driverLocationInterval = null;
    }

    if (locationWatchId) {
        stopWatchingPosition(locationWatchId);
        locationWatchId = null;
    }

    const mapContainer = document.getElementById('tracking-map-container');
    if (mapContainer) mapContainer.style.display = 'none';
}

function updatePendingUI(ride) {
    elements.bookingStatusContainer.innerHTML = `
        <div class="request-card" style="border: 2px solid var(--secondary); text-align: center;">
            <div class="loader" style="margin: 0 auto 15px;"></div>
            <h3 style="color: var(--secondary);">Searching for Drivers...</h3>
            <p style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">
                ${ride.pickup_location} → ${ride.dropoff_location}<br>
                Fare: <strong>${ride.price > 0 ? `₱${ride.price}` : 'Finalizing Fare...'}</strong>
            </p>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button onclick="window.checkActiveRide()" class="btn" style="flex: 1; background: #f1f5f9; color: var(--text-main); font-size: 12px; height: 44px;"><i class='bx bx-refresh'></i> Refresh Status</button>
                <button onclick="window.cancelRide(${ride.ride_id})" class="btn" style="flex: 1; background: #fef2f2; color: #ef4444; font-size: 12px; height: 44px;">Cancel</button>
            </div>
        </div>
    `;
}

function updateAcceptedUI(ride, driver) {
    const isAccepted = ride.status === 'accepted';
    const progressPercent = isAccepted ? 30 : 75;

    elements.bookingStatusContainer.innerHTML = `
        <div class="request-card" style="border: 2px solid #10b981; padding: 20px; border-radius: 20px; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div class="driver-avatar" style="width: 55px; height: 55px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid #f0fdf4; overflow: hidden;">
                    ${driver?.avatar_url
            ? `<img src="${driver.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;">`
            : `<i class='bx bxs-user' style="font-size: 30px; color: #10b981;"></i>`
        }
                </div>
                <div style="flex: 1;">
                    <h3 style="margin: 0; font-size: 16px; color: var(--text-main);">${driver?.fullname || 'Driver'}</h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px;">
                        <span style="background: #10b981; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">PLATE: ${driver?.pedicab_plate || 'N/A'}</span>
                        <span style="background: #e2e8f0; color: #475569; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;">${driver?.registration_group || 'Verified'}</span>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 11px; color: #059669; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">
                        ${isAccepted ? 'Driver Assigned' : 'Heading to Destination'}
                    </span>
                    <span style="font-size: 11px; font-weight: 700; color: var(--text-muted);">${progressPercent}%</span>
                </div>
                <div style="height: 10px; background: #f1f5f9; border-radius: 10px; overflow: hidden; position: relative; border: 1px solid #e2e8f0;">
                    <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399); transition: width 1s ease-in-out; position: relative;">
                        <div style="position: absolute; right: 0; top: 0; height: 100%; width: 20px; background: rgba(255,255,255,0.3); transform: skewX(-20deg);"></div>
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 10px;">
                <button onclick="window.openChat(${ride.ride_id}, '${driver?.fullname || 'Driver'}')" class="btn" style="flex: 1; height: 48px; background: #e0f2fe; color: #0284c7; border: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600;"><i class='bx bxs-chat'></i> Chat</button>
                ${driver?.phone ? `<a href="tel:${driver.phone}" class="btn" style="width: 55px; height: 48px; background: #10b981; border: none; display: flex; align-items: center; justify-content: center; text-decoration: none; font-weight: 600; color: white;"><i class='bx bxs-phone'></i></a>` : ''}
                <button onclick="window.triggerEmergency(${ride.ride_id})" class="btn" style="width: 55px; height: 48px; background: #fee2e2; color: #dc2626; border: 2px solid #fecaca; display: flex; align-items: center; justify-content: center; font-size: 20px;"><i class='bx bxs-megaphone'></i></button>
            </div>
            <p style="text-align: center; font-size: 12px; color: var(--text-muted); margin-top: 15px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                <i class='bx bxs-map' style="color: #ef4444;"></i> Going to: <strong>${ride.dropoff_location}</strong>
            </p>
        </div>
    `;
}

function showCompletionUI(ride) {
    elements.bookingStatusContainer.style.display = 'block';
    elements.requestFormContainer.style.display = 'none';
    elements.bookingStatusContainer.innerHTML = `
        <div class="request-card" style="border: 2px solid #10b981; text-align: center; background: white; box-shadow: 0 20px 40px rgba(0,0,0,0.1); animation: slideUp 0.5s ease-out;">
            <div style="width: 80px; height: 80px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <i class='bx bx-check' style="font-size: 50px; color: #10b981;"></i>
            </div>
            <h2 style="color: #064e3b; margin-bottom: 5px; font-size: 24px;">Trip Complete!</h2>
            <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 24px;">You have arrived safely.</p>
            
            <div style="background: #f0fdf4; padding: 24px; border-radius: 20px; margin: 20px 0; border: 2px dashed #10b981;">
                <span style="font-size: 11px; color: #059669; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">TOTAL FARE PAID</span>
                <h1 style="font-size: 42px; color: #064e3b; margin: 10px 0;">₱${parseFloat(ride.price).toFixed(2)}</h1>
            </div>

            <div style="margin-bottom: 20px;">
                <p style="font-size: 13px; font-weight: 700; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase;">Rate your Driver</p>
                <div style="display: flex; justify-content: center; gap: 8px; margin-bottom: 15px;">
                    ${[1, 2, 3, 4, 5].map(i => `<i class='bx bx-star' id="star-${i}" onclick="window.setRating(${i})" style="font-size: 32px; color: #cbd5e1; cursor: pointer;"></i>`).join('')}
                </div>
                <textarea id="driver-feedback" placeholder="Leave a comment (Optional)..." style="width: 100%; height: 60px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 13px; outline: none; resize: none;"></textarea>
            </div>

            <button onclick="window.dismissCompletion(${ride.ride_id})" class="btn btn-request btn-submit-rating" style="width: 100%; height: 56px; margin-top: 10px;">Submit & Close</button>
        </div>
    `;
}

// --- GLOBAL ACTIONS EXPOSED TO WINDOW ---

window.requestRide = async () => {
    const pickup = elements.pickupInput.value;
    const dropoff = elements.dropoffInput.value;

    if (!pickup || !dropoff) {
        alert('Please enter your locations.');
        return;
    }

    try {
        elements.requestBtn.disabled = true;
        elements.requestBtn.innerText = 'Geocoding...';

        // Geocode locations
        // 1. Pickup Coords handling
        let pickupCoords = null;
        if (selectedPickupCoords && pickup === manualPickupAddress) {
            console.log("Using map-pinned coordinates for pickup");
            pickupCoords = selectedPickupCoords;
        } else if (detectedAddressString && pickup === detectedAddressString && currentPassengerLat && currentPassengerLng) {
            console.log("Using exact GPS coordinates for pickup");
            pickupCoords = { lat: currentPassengerLat, lng: currentPassengerLng };
        } else {
            console.log("Geocoding manual pickup address");
            pickupCoords = await geocodeAddress(pickup);
        }

        // 2. Dropoff Coords handling
        let dropoffCoords = null;
        if (selectedDropoffCoords && dropoff === manualDropoffAddress) {
            console.log("Using map-pinned coordinates for dropoff");
            dropoffCoords = selectedDropoffCoords;
        } else {
            console.log("Geocoding manual dropoff address");
            dropoffCoords = await geocodeAddress(dropoff);
        }

        elements.requestBtn.innerText = 'Requesting...';
        await CommuterRides.requestRide(currentUser.id, pickup, dropoff, pickupCoords, dropoffCoords);
        elements.pickupInput.value = '';
        elements.dropoffInput.value = '';
        await checkActiveRide();
    } catch (err) {
        alert(err.message);
    } finally {
        elements.requestBtn.disabled = false;
        elements.requestBtn.innerText = 'Request Pedicab';
    }
};

window.cancelRide = async (rideId) => {
    if (!await showConfirm('Are you sure you want to cancel this request?')) return;
    try {
        await CommuterRides.cancelRide(rideId);
        await checkActiveRide();
    } catch (err) {
        alert(err.message);
    }
};

window.cancelAllMyRides = async () => {
    if (!await showConfirm('This will clear your pending requests. Continue?')) return;
    try {
        await CommuterRides.cancelAllPendingRides(currentUser.id);
        await checkActiveRide();
    } catch (err) {
        alert(err.message);
    }
};

window.setRating = (n) => {
    currentRating = n;
    for (let i = 1; i <= 5; i++) {
        const star = document.getElementById(`star-${i}`);
        if (i <= n) {
            star.className = 'bx bxs-star';
            star.style.color = '#f59e0b';
        } else {
            star.className = 'bx bx-star';
            star.style.color = '#cbd5e1';
        }
    }
};

window.dismissCompletion = async (rideId) => {
    const feedback = document.getElementById('driver-feedback')?.value || '';
    const btn = document.querySelector('.btn-submit-rating');
    if (btn) btn.innerText = 'Submitting...';

    try {
        await CommuterRides.saveRating(rideId, currentRating, feedback);
        sessionStorage.setItem(`seen_completed_${rideId}`, 'true');
        elements.bookingStatusContainer.style.display = 'none';
        elements.requestFormContainer.style.display = 'block';
        location.reload(); // Refresh to clear state
    } catch (err) {
        console.error(err);
        location.reload();
    }
};

window.triggerEmergency = async (rideId) => {
    if (!await showConfirm("🚨 DO YOU NEED EMERGENCY ASSISTANCE? This will alert the TMO and local authorities immediately.")) return;

    try {
        const pos = await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
        }).catch(() => ({ coords: { latitude: 9.3068, longitude: 123.3033 } }));

        await CommuterRides.createEmergencySOS(currentUser.id, rideId, pos.coords.latitude, pos.coords.longitude);

        // UI Feedback - Show SOS Overlay
        activateSOSUI(false); // false = isPassenger
        AudioService.playAlertSound();
    } catch (err) {
        alert("SOS Failed: " + err.message);
    }
};

// --- CHAT ACTIONS ---

window.openChat = (rideId, driverName) => {
    chatRideId = rideId;
    document.getElementById('chat-driver-name').innerText = driverName || 'Driver';
    elements.chatOverlay.style.display = 'flex';
    loadChatMessages();
    chatInterval = setInterval(loadChatMessages, 3000);
};

window.closeChat = () => {
    elements.chatOverlay.style.display = 'none';
    if (chatInterval) clearInterval(chatInterval);
    chatRideId = null;
};

async function loadChatMessages() {
    if (!chatRideId) return;
    try {
        const msgs = await CommuterChat.fetchMessages(chatRideId);
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
    } catch (err) { console.error(err); }
}

window.sendChat = async () => {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content || !chatRideId) return;

    try {
        input.value = '';
        await CommuterChat.sendMessage(chatRideId, currentUser.id, content);
        await loadChatMessages();
    } catch (err) { alert(err.message); }
};

// --- PROFILE & CONTACT ACTIONS ---

window.logout = () => CommuterAuth.logoutPassenger();

window.openHistory = async () => {
    const header = document.querySelector('.app-header');
    if (header) header.style.display = 'none';
    elements.historyOverlay.style.display = 'flex';
    await CommuterRides.fetchTripHistory(currentUser.id).then(updateTripHistoryUI);
    await loadSuggestions();
};

window.closeHistory = (e) => {
    if (e && e.target !== e.currentTarget) return;
    const header = document.querySelector('.app-header');
    if (header && document.getElementById('view-home').style.display !== 'none') header.style.display = 'flex';
    elements.historyOverlay.style.display = 'none';
};

window.openEmergencyContact = async () => {
    elements.emergencyContactOverlay.style.display = 'flex';
    try {
        const contact = await CommuterProfile.getEmergencyContact(currentUser.id);
        if (contact) {
            document.getElementById('emergency-name').value = contact.emergency_contact_name || '';
            document.getElementById('emergency-phone').value = contact.emergency_contact_phone || '';
        }
    } catch (err) { console.error(err); }
};

window.closeEmergencyContact = (e) => {
    if (e && e.target !== e.currentTarget) return;
    elements.emergencyContactOverlay.style.display = 'none';
    elements.profileOverlay.style.display = 'flex'; // Go back to profile
};

window.saveEmergencyContact = async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('emergency-name').value;
    const phone = document.getElementById('emergency-phone').value;

    if (!name || !phone) {
        alert("Please fill in both name and number.");
        return;
    }

    try {
        btn.innerText = "Saving...";
        btn.disabled = true;
        await CommuterProfile.updateEmergencyContact(currentUser.id, name, phone);
        alert("Emergency contact saved!");
        window.closeEmergencyContact();
    } catch (err) {
        alert(err.message);
    } finally {
        btn.innerText = "Save Contact Details";
        btn.disabled = false;
        btn.style.color = "white";
    }
};

window.openEditProfile = () => {
    document.getElementById('edit-fullname').value = currentUser.user_metadata.full_name || '';
    document.getElementById('edit-phone').value = currentUser.user_metadata.phone || '';
    document.getElementById('edit-color').value = currentUser.user_metadata.preferred_color || '#f4f7fe';
    elements.profileOverlay.style.display = 'none';
    elements.editProfileOverlay.style.display = 'flex';

    const currentAvatar = currentUser.user_metadata.avatar_url;
    const preview = document.getElementById('edit-avatar-preview');
    preview.innerHTML = currentAvatar ? `<img src="${currentAvatar}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class='bx bxs-camera' style="font-size: 24px; color: #cbd5e1;"></i>`;
};

window.closeEditProfile = (e) => {
    if (e && e.target !== e.currentTarget) return;
    elements.editProfileOverlay.style.display = 'none';
    elements.profileOverlay.style.display = 'flex'; // Go back to profile instead of home
};

window.previewAvatar = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('edit-avatar-preview').innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.saveProfile = async () => {
    const btn = document.getElementById('save-profile-btn');
    const name = document.getElementById('edit-fullname').value;
    const phone = document.getElementById('edit-phone').value;
    const color = document.getElementById('edit-color').value;
    const file = document.getElementById('avatar-upload').files[0];

    if (!name) { alert('Full name is required'); return; }

    try {
        btn.innerText = 'Saving...';
        btn.disabled = true;
        await CommuterProfile.updateProfile(currentUser.id, name, phone, file, color);
        alert('Profile updated!');
        location.reload();
    } catch (err) {
        alert(err.message);
    } finally {
        btn.innerText = 'Save Changes';
        btn.disabled = false;
        btn.style.color = 'white'; // Ensure text color is reset
    }
};

// --- UI UPDATERS ---

function updateAvatarUI(url) {
    const profileAvatarEl = document.querySelector('.profile-avatar');
    const headerAvatarEl = elements.profileBtn;
    const avatarHtml = url ? `<img src="${url}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class='bx bxs-user-circle'></i>`;
    const headerHtml = url ? `<img src="${url}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class='bx bxs-user-circle' style="font-size: 20px;"></i>`;

    if (profileAvatarEl) profileAvatarEl.innerHTML = avatarHtml;
    if (headerAvatarEl) headerAvatarEl.innerHTML = headerHtml;
}

function updateAvailableDriversUI(drivers) {
    const container = document.getElementById('available-drivers');
    if (drivers && drivers.length > 0) {
        container.innerHTML = drivers.map(d => `
            <div class="driver-list-item">
                <div class="driver-avatar" style="overflow: hidden; display: flex; align-items: center; justify-content: center;">
                    ${d.users?.avatar_url ? `<img src="${d.users.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class='bx bxs-user'></i>`}
                </div>
                <div class="driver-info">
                    <h4>${d.users?.fullname || 'Driver'}</h4>
                    <p>${d.registration_group || 'Verified Driver'} • #${d.pedicab_plate}</p>
                </div>
                <div class="driver-status">Available</div>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Searching for nearby pedicabs...</p>';
    }
}

const shortenAddress = (addr) => {
    if (!addr) return '';
    const parts = addr.split(',');
    let short = parts[0].trim();
    // If first part is just a number (like street number), try including the second part
    if (short.match(/^\d+$/) && parts.length > 1) {
        short += ' ' + parts[1].trim();
    }
    return short.length > 25 ? short.substring(0, 22) + '...' : short;
};

function updateTripHistoryUI(trips) {
    const container = document.getElementById('trip-history');
    if (trips && trips.length > 0) {
        container.innerHTML = trips.map(t => {
            const tripDate = new Date(t.request_time);
            return `
                <div class="trip-item">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 32px; height: 32px; background: #fdf2f8; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                ${t.users?.avatar_url ? `<img src="${t.users.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class='bx bxs-user' style="color: var(--secondary); font-size: 16px;"></i>`}
                            </div>
                            <div>
                                <p style="font-size: 13px; font-weight: 700; color: var(--text-main);">${t.users?.fullname || 'Driver'}</p>
                                <p style="font-size: 10px; color: var(--text-muted);">${tripDate.toLocaleDateString()} • ${tripDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                        </div>
                        <p style="font-weight: 800; color: var(--secondary); font-size: 15px;">₱${parseFloat(t.price).toFixed(2)}</p>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px; padding-left: 14px; border-left: 2px dashed #e2e8f0; margin-left: 15px; position: relative;">
                        <div style="display: flex; align-items: start; gap: 10px; position: relative;">
                            <div style="position: absolute; left: -18px; top: 4px; width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></div>
                            <div>
                                <p style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Pickup</p>
                                <p style="font-size: 13px; color: var(--text-main); font-weight: 500;">${shortenAddress(t.pickup_location)}</p>
                            </div>
                        </div>
                        <div style="display: flex; align-items: start; gap: 10px; position: relative; margin-top: 4px;">
                            <div style="position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; color: #ef4444;"><i class='bx bxs-map' style="font-size: 10px;"></i></div>
                            <div>
                                <p style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Drop-off</p>
                                <p style="font-size: 13px; color: var(--text-main); font-weight: 600;">${shortenAddress(t.dropoff_location)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">No trip history yet.</p>';
    }
}

async function loadProfileStats() {
    const stats = await CommuterProfile.getProfileStats(currentUser.id);
    const tripsEl = document.getElementById('stat-trips');
    if (tripsEl) tripsEl.innerText = stats.completedTrips;
    if (stats.joinedDate) {
        document.getElementById('stat-since').innerText = stats.joinedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
}

async function loadSuggestions() {
    const suggestions = await CommuterRides.fetchSuggestions(currentUser.id);
    const container = document.getElementById('frequent-routes');
    if (container && suggestions.length > 0) {
        container.innerHTML = suggestions.map(r => {
            const [p, d] = r.split(' → ');
            const display = `${shortenAddress(p)} → ${shortenAddress(d)}`;
            return `
                <div class="suggestion-chip" onclick="window.useRoute('${r}')">
                    <i class='bx bx-history'></i> ${display}
                </div>
            `;
        }).join('');
    }
}

window.useRoute = (route) => {
    const [p, d] = route.split(' → ');
    elements.pickupInput.value = p;
    elements.dropoffInput.value = d;
    window.closeHistory();
};

function showCityAlert(message) {
    elements.alertText.innerText = message;
    elements.cityAlertBanner.style.display = 'block';
    elements.notifDot.style.display = 'block';
    AudioService.playAlertSound();
    setTimeout(() => { elements.cityAlertBanner.style.display = 'none'; }, 10000);
}
// --- HELPER FUNCTIONS ---

async function autoLocateUser() {
    if (elements.pickupInput.value) return;

    try {
        elements.pickupInput.placeholder = "🔍 Finding your precise location...";

        // This now waits up to 10s for a high-accuracy GPS lock
        const pos = await getCurrentPosition();

        if (!pos) {
            console.warn("GPS failed or denied.");
            elements.pickupInput.placeholder = "📍 Enable GPS & Tap to Locate";
            showCityAlert("⚠️ Location access denied or unavailable. Please enable GPS for accurate pickup.");

            // Add a clickable handler to retry
            elements.pickupInput.onclick = () => {
                elements.pickupInput.onclick = null; // Remove handler
                autoLocateUser();
            };
            return;
        }

        // Check accuracy - warn if it's too loose (e.g. > 100 meters)
        if (pos.accuracy && pos.accuracy > 100) {
            showCityAlert(`⚠️ Weak GPS signal (Accuracy: ${Math.round(pos.accuracy)}m). Please verify your pin on the map.`);
        }

        currentPassengerLat = pos.lat;
        currentPassengerLng = pos.lng;

        // Update map marker instantly to where the GPS says
        if (passengerMap) {
            const userIcon = `<div class="user-location-marker"></div>`;
            addMarker(`passenger-${currentUser.id}`, pos.lat, pos.lng, {
                icon: userIcon,
                title: "You",
                popup: `Location Accuracy: ${Math.round(pos.accuracy || 0)}m`
            });
            centerMap(pos.lat, pos.lng, 18); // Zoom in close directly
        }

        const address = await reverseGeocode(pos.lat, pos.lng);

        if (address) {
            detectedAddressString = address;
            elements.pickupInput.value = address;
            elements.pickupInput.style.border = "2px solid #10b981";
            elements.pickupInput.style.background = "#f0fdf4";
        }

    } catch (e) {
        console.error("Auto-locate failed:", e);
        elements.pickupInput.placeholder = "Enter Pick-up Location";
        showCityAlert("Could not determine location. Please enter manually.");
    }
}

window.closeProfile = (e) => {
    if (e && e.target !== e.currentTarget) return;
    const header = document.querySelector('.app-header');
    if (header && document.getElementById('view-map').style.display === 'none') header.style.display = 'flex';
    elements.profileOverlay.style.display = 'none';
};

// Map window functions for older code compatibility if any
window.checkActiveRide = checkActiveRide;

// --- MAP INTEGRATION ---

let passengerMap = null;
let locationWatchId = null;
let driverLocationInterval = null;
let currentPassengerLat = null;
let currentPassengerLng = null;

// Initialize Map
// Initialize Map
// Initialize Map
async function initPassengerMap() {
    // Prevent re-initializing the map if it's already active (fixes 5s refresh flicker)
    // switchTab() handles clearing this when changing views
    if (passengerMap) return passengerMap;

    const defaultLat = 9.3068;
    const defaultLng = 123.3033;

    // Use last known if available, else default
    let startLat = currentPassengerLat || defaultLat;
    let startLng = currentPassengerLng || defaultLng;

    // Init map IMMEDIATELY (Fast Load) - do not wait for GPS
    passengerMap = initMap('passenger-map', { lat: startLat, lng: startLng });

    // Try to get fresh GPS in background
    getCurrentPosition().then(pos => {
        if (pos) {
            currentPassengerLat = pos.lat;
            currentPassengerLng = pos.lng;

            // Add/Update user marker
            const userIcon = `<div class="user-location-marker"></div>`;
            addMarker(`passenger-${currentUser.id}`, pos.lat, pos.lng, {
                icon: userIcon,
                title: "You",
                popup: `Accuracy: ${Math.round(pos.accuracy)}m`
            });

            // Pan map to user
            centerMap(pos.lat, pos.lng);
        }
    }).catch(console.warn);

    return passengerMap;
}

// --- EXPLORATION MAP & TABS ---
let explorationMapInitialized = false;

window.switchTab = (tab) => {
    console.log('Switching tab to:', tab);
    const homeView = document.getElementById('view-home');
    const mapView = document.getElementById('view-map');
    const header = document.querySelector('.app-header');

    const navHome = document.getElementById('nav-home');
    const navMap = document.getElementById('nav-map');
    const navHistory = document.getElementById('nav-history');
    const navProfile = document.getElementById('nav-profile');

    // Hide all overlays first
    const overlays = ['profileOverlay', 'historyOverlay', 'editProfileOverlay', 'emergencyContactOverlay'];
    overlays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Reset view visibility
    if (homeView) homeView.style.display = 'none';
    if (mapView) mapView.style.display = 'none';
    if (header) header.style.display = 'flex';

    // Remove active class from all tabs
    [navHome, navMap, navHistory, navProfile].forEach(el => {
        if (el) el.classList.remove('active');
    });

    // Reset active map ref to force re-init on new tab
    if (tab === 'home' || tab === 'map') {
        passengerMap = null;
    }

    if (tab === 'home' && homeView) {
        homeView.style.display = 'block';
        if (navHome) navHome.classList.add('active');
        checkActiveRide();
    } else if (tab === 'map' && mapView) {
        mapView.style.display = 'block';
        if (header) header.style.display = 'none';
        if (navMap) navMap.classList.add('active');
        setTimeout(initExplorationMap, 100);
    } else if (tab === 'history') {
        if (homeView) homeView.style.display = 'block';
        if (header) header.style.display = 'none';
        if (navHistory) navHistory.classList.add('active');
        window.openHistory();
    } else if (tab === 'profile') {
        if (homeView) homeView.style.display = 'block';
        if (header) header.style.display = 'none';
        if (navProfile) navProfile.classList.add('active');
        if (elements.profileOverlay) elements.profileOverlay.style.display = 'flex';
    }
};

async function initExplorationMap() {
    const defaultLat = 9.3068;
    const defaultLng = 123.3033;

    // Use last known if available, else default
    let lat = currentPassengerLat || defaultLat;
    let lng = currentPassengerLng || defaultLng;

    // 1. Init Map Instantly
    passengerMap = initMap('exploration-map', { lat, lng }, 16);
    // Note: markers are cleared inside initMap now, so we start fresh

    // 2. Add "You" Marker Immediately (even if using default)
    const addYouMarker = (l, ln, acc = null) => {
        const userIcon = `<div class="user-location-marker"></div>`;
        addMarker(`passenger-${currentUser.id}`, l, ln, {
            icon: userIcon,
            title: "You",
            popup: acc ? `Accuracy: ${Math.round(acc)}m` : "Approximate Location"
        });
    };
    addYouMarker(lat, lng);

    // 3. Fetch Fresh GPS in Background
    getCurrentPosition().then(pos => {
        if (pos) {
            currentPassengerLat = pos.lat;
            currentPassengerLng = pos.lng;
            addYouMarker(pos.lat, pos.lng, pos.accuracy);
            // Optional: Pan to user if they haven't moved map too much? 
            // For now, let's center them to be helpful
            centerMap(pos.lat, pos.lng);
        }
    }).catch(console.warn);

    // 4. Fetch Drivers
    try {
        const drivers = await CommuterRides.fetchAvailableDrivers();
        drivers.forEach(d => {
            if (d.current_lat && d.current_lng) {
                const dUser = Array.isArray(d.users) ? d.users[0] : d.users;
                addDriverMarker(d.driver_id, d.current_lat, d.current_lng, dUser?.fullname || 'Driver');
            }
        });
    } catch (e) {
        console.error("Error loading drivers for map:", e);
    }

    // 5. Add Click Listener for pinning
    if (passengerMap) {
        passengerMap.on('click', async (e) => {
            const { lat, lng } = e.latlng;

            // Remove previous temp marker if any
            removeMarker('temp-pin');

            // Add a temp pin
            const tempIcon = `<div style="background: var(--primary); width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.2);"><div style="width: 10px; height: 10px; background: white; border-radius: 50%; margin: 7px; transform: rotate(45deg);"></div></div>`;
            const marker = addMarker('temp-pin', lat, lng, {
                icon: tempIcon,
                title: "Selected Location"
            });

            // Get address for the popup
            const address = await reverseGeocode(lat, lng);

            const popupHtml = `
                <div style="padding: 10px; min-width: 150px; font-family: 'Outfit', sans-serif;">
                    <p style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">${address}</p>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button onclick="window.setPinLocation('pickup', ${lat}, ${lng}, '${address.replace(/'/g, "\\'")}')" 
                            style="background: #10b981; color: white; border: none; padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
                            SET AS PICKUP
                        </button>
                        <button onclick="window.setPinLocation('dropoff', ${lat}, ${lng}, '${address.replace(/'/g, "\\'")}')" 
                            style="background: #ef4444; color: white; border: none; padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
                            SET AS DROPOFF
                        </button>
                    </div>
                </div>
            `;
            marker.bindPopup(popupHtml).openPopup();
        });
    }
}

window.setPinLocation = (type, lat, lng, address) => {
    if (type === 'pickup') {
        selectedPickupCoords = { lat, lng };
        manualPickupAddress = address;
        if (elements.pickupInput) {
            elements.pickupInput.value = address;
            elements.pickupInput.style.border = "2px solid #10b981";
        }
    } else {
        selectedDropoffCoords = { lat, lng };
        manualDropoffAddress = address;
        if (elements.dropoffInput) {
            elements.dropoffInput.value = address;
            elements.dropoffInput.style.border = "2px solid #ef4444";
        }
    }

    // Inform user
    alert(`${type === 'pickup' ? 'Pickup' : 'Drop-off'} location set to: ${address}`);

    // Switch back to home
    window.switchTab('home');
};

function setupAutocomplete(input, container, type) {
    if (!input || !container) return;

    let timeout = null;

    input.addEventListener('input', () => {
        clearTimeout(timeout);
        const query = input.value.trim();

        if (query.length < 3) {
            container.style.display = 'none';
            return;
        }

        timeout = setTimeout(async () => {
            const suggestions = await getAddressSuggestions(query);
            if (suggestions.length > 0) {
                container.innerHTML = suggestions.map(s => `
                    <div class="suggestion-item" onclick="window.selectSuggestion('${type}', '${s.displayName.replace(/'/g, "\\'")}', ${s.lat}, ${s.lng})">
                        <i class='bx bxs-map-pin'></i>
                        <span>${s.displayName}</span>
                    </div>
                `).join('');
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        }, 400); // 400ms debounce
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !container.contains(e.target)) {
            container.style.display = 'none';
        }
    });
}

window.selectSuggestion = (type, address, lat, lng) => {
    if (type === 'pickup') {
        elements.pickupInput.value = address;
        elements.pickupSuggestions.style.display = 'none';
        selectedPickupCoords = { lat, lng };
        manualPickupAddress = address;
    } else {
        elements.dropoffInput.value = address;
        elements.dropoffSuggestions.style.display = 'none';
        selectedDropoffCoords = { lat, lng };
        manualDropoffAddress = address;
    }
};

// Start
init();
