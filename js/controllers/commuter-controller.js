
import { supabaseClient } from '../services/config.js';
import * as CommuterAuth from '../services/commuter-auth.js';
import * as CommuterRides from '../services/commuter-rides.js';
import * as CommuterProfile from '../services/commuter-profile.js';
import * as CommuterChat from '../services/commuter-chat.js';
import * as AudioService from '../services/audio.js';
import { applyTheme, activateSOSUI } from '../utils/ui.js';

// State
let currentUser = null;
let currentRating = 0;
let chatRideId = null;
let chatInterval = null;
let lastRideStatus = null;

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
            elements.profileOverlay.style.display = 'flex';
        });
    }
    const navProfile = document.getElementById('nav-profile');
    if (navProfile) {
        navProfile.addEventListener('click', (e) => {
            e.preventDefault();
            elements.profileOverlay.style.display = 'flex';
        });
    }

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
        } else {
            const driverDetails = await CommuterRides.fetchDriverDetails(ride.driver_id);
            updateAcceptedUI(ride, driverDetails);

            // Start tracking map
            startTrackingDriver(ride.driver_id, ride.pickup_location, ride.dropoff_location);
        }

    } catch (err) {
        console.error('Error in checkActiveRide:', err);
    }
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
        elements.requestBtn.innerText = 'Requesting...';
        await CommuterRides.requestRide(currentUser.id, pickup, dropoff);
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
    if (!confirm('Are you sure you want to cancel this request?')) return;
    try {
        await CommuterRides.cancelRide(rideId);
        await checkActiveRide();
    } catch (err) {
        alert(err.message);
    }
};

window.cancelAllMyRides = async () => {
    if (!confirm('This will clear your pending requests. Continue?')) return;
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
    if (!confirm("🚨 DO YOU NEED EMERGENCY ASSISTANCE? This will alert the TMO and local authorities immediately.")) return;

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
    elements.historyOverlay.style.display = 'flex';
    await CommuterRides.fetchTripHistory(currentUser.id).then(updateTripHistoryUI);
    await loadSuggestions();
};

window.closeHistory = (e) => {
    if (e && e.target !== e.currentTarget) return;
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
        btn.innerText = "Save to Database";
        btn.disabled = false;
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
                                <p style="font-size: 13px; color: var(--text-main); font-weight: 500;">${t.pickup_location}</p>
                            </div>
                        </div>
                        <div style="display: flex; align-items: start; gap: 10px; position: relative; margin-top: 4px;">
                            <div style="position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; color: #ef4444;"><i class='bx bxs-map' style="font-size: 10px;"></i></div>
                            <div>
                                <p style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Drop-off</p>
                                <p style="font-size: 13px; color: var(--text-main); font-weight: 600;">${t.dropoff_location}</p>
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
        container.innerHTML = suggestions.map(r => `
            <div class="suggestion-chip" onclick="window.useRoute('${r}')">
                <i class='bx bx-history'></i> ${r}
            </div>
        `).join('');
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
    if (elements.pickupInput.value) return; // Don't overwrite if already filled

    try {
        elements.pickupInput.placeholder = "Getting current location...";
        const pos = await getCurrentPosition();

        if (pos) {
            // Store for map use
            currentPassengerLat = pos.lat;
            currentPassengerLng = pos.lng;

            // Reverse geocode to get address
            const address = await reverseGeocode(pos.lat, pos.lng);

            if (address) {
                elements.pickupInput.value = address;
                // Add a cute icon or indicator that it was auto-detected
                elements.pickupInput.style.border = "1px solid #10b981";
            }
        }
    } catch (e) {
        console.error("Auto-locate failed:", e);
        elements.pickupInput.placeholder = "Enter Pick-up Location";
    }
}

window.closeProfile = (e) => {
    if (e && e.target !== e.currentTarget) return;
    elements.profileOverlay.style.display = 'none';
};

// Map window functions for older code compatibility if any
window.checkActiveRide = checkActiveRide;

// --- MAP INTEGRATION ---
import { initMap, addPassengerMarker, addDriverMarker, addDestinationMarker, drawRoute, drawMultiPointRoute, fitBounds, centerMap, updateMarkerPosition, clearAllMarkers, clearRoute } from '../utils/map.js';
import { getCurrentPosition, geocodeAddress, watchPosition, stopWatchingPosition, calculateDistance, reverseGeocode } from '../services/location.js';

let passengerMap = null;
let locationWatchId = null;
let driverLocationInterval = null;
let currentPassengerLat = null;
let currentPassengerLng = null;

// Initialize Map
function initPassengerMap() {
    if (passengerMap) return;

    // Get current location
    getCurrentPosition().then(pos => {
        currentPassengerLat = pos.lat;
        currentPassengerLng = pos.lng;

        passengerMap = initMap('passenger-map', { lat: pos.lat, lng: pos.lng });
        addPassengerMarker(currentUser.id, pos.lat, pos.lng, "You");
    });
}

// Start tracking driver during active ride
function startTrackingDriver(driverId, pickup, dropoff) {
    // Show map container
    const mapContainer = document.getElementById('tracking-map-container');
    if (mapContainer) mapContainer.style.display = 'block';

    // Init map if needed
    initPassengerMap();

    // Clear previous intervals
    if (driverLocationInterval) clearInterval(driverLocationInterval);

    // Initial map setup with route
    setupRideMap(driverId, pickup, dropoff);

    // Poll driver location every 5 seconds
    driverLocationInterval = setInterval(() => {
        updateDriverLocationOnMap(driverId);
    }, 5000);
}

async function setupRideMap(driverId, pickup, dropoff) {
    if (!passengerMap) return;

    clearAllMarkers();
    clearRoute();

    // Add passenger location
    if (currentPassengerLat && currentPassengerLng) {
        addPassengerMarker(currentUser.id, currentPassengerLat, currentPassengerLng, "You");
    }

    // Geocode locations if needed
    // For now, assuming pickup/dropoff are names, we'd need coordinates
    // This part requires the rides table to have coordinates populated
    // We'll update the markers once we have the driver's location

    updateDriverLocationOnMap(driverId);
}

async function updateDriverLocationOnMap(driverId) {
    try {
        const { data, error } = await supabaseClient
            .from('drivers')
            .select('current_lat, current_lng, users(fullname)')
            .eq('driver_id', driverId)
            .single();

        if (error) throw error;

        if (data && data.current_lat && data.current_lng) {
            // Update driver marker
            addDriverMarker(driverId, data.current_lat, data.current_lng, data.users?.fullname || 'Driver');

            // If we have passenger location, draw route
            if (currentPassengerLat && currentPassengerLng) {
                // Draw route from driver to passenger (or to dropoff if accepted)
                // For simplified version, just fit bounds
                fitBounds();

                // Calculate distance/ETA
                const dist = calculateDistance(
                    currentPassengerLat, currentPassengerLng,
                    data.current_lat, data.current_lng
                );

                // Update UI stats
                const distEl = document.getElementById('tracking-distance');
                const etaEl = document.getElementById('tracking-eta');

                if (distEl) distEl.innerText = `${dist.toFixed(1)} km`;
                if (etaEl) etaEl.innerText = `${Math.ceil(dist * 5)} mins`; // Rough estimate: 5 min per km
            }
        }
    } catch (err) {
        console.error('Error updating driver location:', err);
    }
}

function stopTrackingDriver() {
    if (driverLocationInterval) {
        clearInterval(driverLocationInterval);
        driverLocationInterval = null;
    }
    const mapContainer = document.getElementById('tracking-map-container');
    if (mapContainer) mapContainer.style.display = 'none';
}

// --- EXPLORATION MAP & TABS ---
let explorationMapInitialized = false;

window.switchTab = (tab) => {
    console.log('Switching tab to:', tab);
    const homeView = document.getElementById('view-home');
    const mapView = document.getElementById('view-map');
    const navHome = document.getElementById('nav-home');
    const navMap = document.getElementById('nav-map');

    if (tab === 'home') {
        homeView.style.display = 'block';
        mapView.style.display = 'none';
        navHome.classList.add('active');
        if (navMap) navMap.classList.remove('active');

        // If we have an active ride, we need to re-attach the tracking map
        // because the singleton map instance might have been hijacked by the exploration map
        checkActiveRide();
    } else if (tab === 'map') {
        homeView.style.display = 'none';
        mapView.style.display = 'block';
        navHome.classList.remove('active');
        if (navMap) navMap.classList.add('active');

        // Initialize Map with a slight delay to ensure container is visible
        setTimeout(initExplorationMap, 100);
    }
};

async function initExplorationMap() {
    // Default location (Dumaguete)
    const lat = currentPassengerLat || 9.3068;
    const lng = currentPassengerLng || 123.3033;

    // Initialize map in the new container
    // Note: This replaces the tracking map instance because map.js is a singleton
    passengerMap = initMap('exploration-map', { lat, lng }, 15);

    // Clear any existing markers (like old route markers)
    clearAllMarkers();
    clearRoute();

    // Add User Marker
    if (currentPassengerLat && currentPassengerLng) {
        addPassengerMarker(currentUser.id, currentPassengerLat, currentPassengerLng, "You");
    }

    // Fetch and show drivers
    try {
        const drivers = await CommuterRides.fetchAvailableDrivers();
        drivers.forEach(d => {
            if (d.current_lat && d.current_lng) {
                // Use the utility to add markers
                const dUser = Array.isArray(d.users) ? d.users[0] : d.users;
                addDriverMarker(d.driver_id, d.current_lat, d.current_lng, dUser?.fullname || 'Driver');
            }
        });
    } catch (e) {
        console.error("Error loading drivers for map:", e);
    }
}

// Start
init();
