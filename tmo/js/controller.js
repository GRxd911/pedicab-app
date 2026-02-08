
import { supabaseClient } from '../../shared/js/config/config.js';
import * as TMOAuth from './auth.js';
import * as TMODashboard from './service.js';
import * as TMOEmergencies from './emergencies.js';

// State
let currentUser = null;
let seenEmergencies = new Set();
let currentDriverFilter = 'all';

// Views
const views = {
    'dashboard': document.getElementById('dashboard-view'),
    'drivers': document.getElementById('drivers-view'),
    'users': document.getElementById('users-view'),
    'emergencies': document.getElementById('emergencies-view'),
    'broadcasting': document.getElementById('broadcast-view')
};

// --- CUSTOM ALERT ---
function showAlert(title, message, type = 'error') {
    return new Promise((resolve) => {
        const existing = document.getElementById('custom-alert-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'custom-alert-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; z-index: 100000; padding: 24px;
        `;

        const icon = type === 'error' ? 'bx-error-circle' : 'bx-check-circle';
        const iconColor = type === 'error' ? '#ef4444' : '#10b981';
        const iconBg = type === 'error' ? '#fef2f2' : '#f0fdf4';
        const primaryColor = '#2D3192';

        const card = document.createElement('div');
        card.style.cssText = `
            background: white; width: 100%; max-width: 380px; border-radius: 28px;
            padding: 32px 24px 24px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            animation: modalFadeIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

        card.innerHTML = `
            <div style="width: 64px; height: 64px; background: ${iconBg}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
                <i class='bx ${icon}' style="font-size: 32px; color: ${iconColor};"></i>
            </div>
            <h3 style="font-size: 20px; font-weight: 800; color: #1e293b; margin-bottom: 8px; font-family: sans-serif;">${title}</h3>
            <p style="font-size: 15px; color: #64748b; line-height: 1.5; margin-bottom: 32px; font-family: sans-serif;">${message}</p>
            <button id="alert-ok" style="width: 100%; height: 52px; background: ${primaryColor}; color: white; border: none; border-radius: 16px; font-weight: 700; font-size: 16px; cursor: pointer; transition: all 0.2s;">Got it</button>
        `;

        // Add Animation Keyframes
        if (!document.getElementById('modal-animations')) {
            const style = document.createElement('style');
            style.id = 'modal-animations';
            style.innerHTML = `
                @keyframes modalFadeIn {
                    from { opacity: 0; transform: scale(0.9) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const okBtn = card.querySelector('#alert-ok');
        okBtn.addEventListener('mouseover', () => okBtn.style.opacity = '0.9');
        okBtn.addEventListener('mouseout', () => okBtn.style.opacity = '1');

        const cleanup = () => {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s ease';
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 200);
        };

        okBtn.onclick = cleanup;
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
    });
}

// --- INITIALIZATION ---
async function init() {
    const session = await TMOAuth.checkTMOSession();
    if (!session) {
        window.location.href = 'signin.html';
        return;
    }
    currentUser = session.user;

    // Initial Load
    await loadDashboardData();
    setupEmergencyListener();
    setupActiveDriversListener();

    // Polling for stats updates (non-critical stuff)
    setInterval(loadDashboardData, 15000);

    // Setup Nav
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const viewName = link.innerText.trim().toLowerCase();
            switchView(viewName, link);
        });
    });
}

// --- MAP INTEGRATION ---
import { initMap, addDriverMarker, addPassengerMarker, addSOSMarker, addDestinationMarker, clearAllMarkers, updateMarkerPosition } from '../../shared/js/utils/map.js';

let tmoMap = null;
let driverMarkers = {};

// Initialize TMO Map
function initTMOMap() {
    if (tmoMap) return;

    // Default center (Cebu City / Dumaguete as per your app)
    // 9.3068° N, 123.3033° E is Dumaguete
    tmoMap = initMap('tmo-map', { lat: 9.3068, lng: 123.3033 }, 13);
}

// Update Map with all active entities
function updateTMOMap(activeDrivers, emergencies) {
    if (!tmoMap) initTMOMap();

    // We don't clear all markers because we want smooth updates
    // But we should remove offline drivers eventually.
    // For now, simpler approach: update active ones

    // 1. Update Drivers
    activeDrivers.forEach(d => {
        const dUser = Array.isArray(d.users) ? d.users[0] : d.users;
        const name = dUser?.fullname || 'Driver';

        if (d.current_lat && d.current_lng) {
            addDriverMarker(d.driver_id, d.current_lat, d.current_lng, `${name} (#${d.pedicab_plate})`);
        }
    });

    // 2. Update Emergencies
    emergencies.forEach(e => {
        if (e.location_lat && e.location_lng && e.status === 'active') {
            addSOSMarker(e.id, e.location_lat, e.location_lng, e.passenger?.fullname || 'Emergency');
            // Auto center on emergency
            tmoMap.setView([e.location_lat, e.location_lng], 16);
        }
    });
}
async function switchView(viewName, linkElement) {
    // Map view names if they differ
    let targetView = viewName;
    if (viewName === 'broadcasting') targetView = 'broadcasting'; // it's 'broadcasting' in views object

    // Update active link
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    linkElement.classList.add('active');

    // Show/Hide views
    Object.keys(views).forEach(v => {
        if (views[v]) views[v].style.display = (v === targetView) ? 'block' : 'none';
    });

    // Load data for view
    if (targetView === 'drivers') await loadDrivers();
    if (targetView === 'users') await loadUsers();
    if (targetView === 'dashboard') await loadDashboardData();
    if (targetView === 'emergencies') await loadEmergencies();
    if (targetView === 'broadcasting') await loadBroadcastsHistory();

    // Fix map rendering if switching back to dashboard
    if (targetView === 'dashboard' && tmoMap) {
        setTimeout(() => tmoMap.invalidateSize(), 100);
    }
}

// --- DATA LOADING ---

async function loadDashboardData() {
    try {
        const stats = await TMODashboard.getDashboardStats();

        document.getElementById('registered-users-count').innerText = stats.userCount.toLocaleString();
        document.getElementById('trips-today-count').innerText = stats.tripsCount;
        document.getElementById('active-emergencies-count').innerText = stats.emergencyCount;
        document.getElementById('active-drivers-count').innerText = stats.activeDrivers.length;
        document.getElementById('pending-verification-count').innerText = stats.pendingCount;

        // Active Drivers List
        const listContainer = document.getElementById('active-drivers-list');
        if (stats.activeDrivers.length > 0) {
            listContainer.innerHTML = stats.activeDrivers.map(d => {
                let timeActive = "Recently";
                if (d.last_status_change) {
                    const diffMins = Math.floor((new Date() - new Date(d.last_status_change)) / 60000);
                    if (diffMins < 1) timeActive = "Just started";
                    else if (diffMins < 60) timeActive = `${diffMins}m`;
                    else timeActive = `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
                }

                // Handle possible array return from Supabase
                const driverUser = Array.isArray(d.users) ? d.users[0] : d.users;

                return `
                    <div class="driver-item">
                        <div>
                            <div style="font-weight: 600;">${driverUser?.fullname || 'Unknown'}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Plate: #${d.pedicab_plate}</div>
                        </div>
                        <div style="text-align: right;">
                            <span class="badge badge-success">Online</span>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Active for ${timeActive}</div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            listContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No active drivers on the road.</p>';
        }

        // Emergency detection via polling fallback
        const activeEmergs = await TMOEmergencies.getActiveEmergencies();
        if (activeEmergs.length > 0) {
            activeEmergs.forEach(emerg => {
                if (!seenEmergencies.has(emerg.id)) {
                    showEmergencyAlert(emerg);
                    seenEmergencies.add(emerg.id);
                }
            });
        } else {
            window.dismissEmergency();
            seenEmergencies.clear();
        }

        // Update Map
        updateTMOMap(stats.activeDrivers, activeEmergs);

        // Update Notification Dot
        const dot = document.getElementById('emergency-dot');
        if (activeEmergs.length > 0) {
            dot.style.display = 'block';
        } else {
            dot.style.display = 'none';
        }

    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

async function loadDrivers() {
    const drivers = await TMODashboard.getDrivers(currentDriverFilter);
    const driverIds = drivers.map(d => d.driver_id);

    let ratingMap = {};
    if (driverIds.length > 0) {
        const ratings = await TMODashboard.getDriverRatings(driverIds);
        ratings.forEach(r => {
            if (!ratingMap[r.driver_id]) ratingMap[r.driver_id] = { sum: 0, count: 0 };
            ratingMap[r.driver_id].sum += r.rating;
            ratingMap[r.driver_id].count++;
        });
    }

    const tbody = document.getElementById('drivers-table-body');

    tbody.innerHTML = drivers.map(d => {
        const r = ratingMap[d.driver_id];
        const avg = r ? (r.sum / r.count).toFixed(1) : 'N/A';

        return `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px;">${(Array.isArray(d.users) ? d.users[0]?.fullname : d.users?.fullname) || '---'}</td>
                <td style="padding: 12px;">${d.users?.phone || '---'}</td>
                <td style="padding: 12px;">${d.pedicab_plate || '---'}</td>
                <td style="padding: 12px;"><span class="badge ${d.status === 'online' ? 'badge-success' : 'badge-primary'}">${d.status}</span></td>
                <td style="padding: 12px;">${avg} ⭐</td>
                <td style="padding: 12px;">
                    <span class="badge ${d.verification_status === 'verified' ? 'badge-success' : 'badge-warning'}">
                        ${d.verification_status || 'Pending'}
                    </span>
                </td>
                <td style="padding: 12px;">
                    ${d.verification_status !== 'verified' ?
                `<button onclick="window.verifyDriver('${d.driver_id}')" class="switcher-btn" style="color: var(--primary); padding: 4px 8px;">Verify</button>` :
                `<span style="color: #10b981; font-weight: 600;">Verified</span>`
            }
                </td>
            </tr>
        `;
    }).join('');
}

async function loadUsers() {
    const users = await TMODashboard.getUsers();
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px;">${u.fullname}</td>
            <td style="padding: 12px;">${u.email}</td>
            <td style="padding: 12px;"><span class="badge badge-primary">${u.role}</span></td>
            <td style="padding: 12px;">${new Date(u.created_at).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

async function loadEmergencies() {
    const logs = await TMOEmergencies.getAllEmergencies();
    const tbody = document.getElementById('emergencies-table-body');
    tbody.innerHTML = logs.map(l => {
        // Extract plate the safe way through the new join structure
        const driverUser = Array.isArray(l.rides?.driver) ? l.rides.driver[0] : l.rides?.driver;
        const driverDetails = Array.isArray(driverUser?.drivers) ? driverUser.drivers[0] : driverUser?.drivers;
        const plate = driverDetails?.pedicab_plate || 'N/A';

        return `
        <tr style="border-bottom: 1px solid #f1f5f9; ${l.status === 'active' ? 'background: #fff1f2;' : ''}">
            <td style="padding: 12px;">${new Date(l.created_at).toLocaleTimeString()}</td>
            <td style="padding: 12px;">${l.passenger?.fullname || 'Unknown'}</td>
            <td style="padding: 12px;">${plate !== 'N/A' ? '#' + plate : 'N/A'}</td>
            <td style="padding: 12px;">${l.passenger?.emergency_contact_name || 'N/A'}</td>
            <td style="padding: 12px;"><span class="badge ${l.status === 'active' ? 'badge-danger' : 'badge-success'}">${l.status}</span></td>
            <td style="padding: 12px;">
                ${l.status === 'active' ? `<button onclick="window.markResolved('${l.id}')" class="switcher-btn">Resolve</button>` : ''}
                <button onclick="window.deleteEmergency('${l.id}')" style="color: #ef4444; border:none; background:none; cursor:pointer;"><i class='bx bx-trash'></i></button>
            </td>
        </tr>
        `;
    }).join('');
}

async function loadBroadcastsHistory() {
    const alerts = await TMODashboard.getBroadcastHistory();
    const container = document.getElementById('recent-broadcasts-list');
    if (alerts.length > 0) {
        container.innerHTML = alerts.map(a => {
            let color = '#3b82f6';
            if (a.type === 'warning') color = '#f59e0b';
            if (a.type === 'danger') color = '#ef4444';
            return `
                <div style="background: #f8fafc; padding: 15px; border-radius: 12px; border-left: 4px solid ${color}; margin-bottom: 12px; position: relative;">
                    <button onclick="window.deleteBroadcast('${a.id}')" style="position: absolute; top: 10px; right: 10px; background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 18px;" title="Delete Alert">
                        <i class='bx bx-trash'></i>
                    </button>
                    <h4 style="font-size: 14px; margin-bottom: 4px;">${a.title}</h4>
                    <p style="font-size: 12px; color: var(--text-muted);">${a.message}</p>
                    <span style="font-size: 10px; color: var(--text-muted); margin-top: 8px; display: block;">${new Date(a.created_at).toLocaleString()}</span>
                </div>
            `;
        }).join('');
    } else {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No broadcast history.</p>';
    }
}

// --- EMERGENCY UI ---

async function showEmergencyAlert(emergency) {
    if (!emergency) return;
    const alertBox = document.getElementById('emergency-alert');
    const details = document.getElementById('emergency-details');

    try {
        // Detailed fetch for UI
        const logs = await TMOEmergencies.getAllEmergencies();
        const data = logs.find(l => l.id === emergency.id);

        if (data) {
            // Extract plate safely
            const driverUser = Array.isArray(data.rides?.driver) ? data.rides.driver[0] : data.rides?.driver;
            const driverDetails = Array.isArray(driverUser?.drivers) ? driverUser.drivers[0] : driverUser?.drivers;
            const plate = driverDetails?.pedicab_plate || 'N/A';

            details.innerHTML = `
                <strong>PASSENGER: ${data.passenger?.fullname || 'Unknown'}</strong> (${data.passenger?.phone || 'No Phone'})<br>
                VEHICLE: #${plate} • TYPE: ${data.type}<br>
                <span style="background: #fff; color: #e11d48; padding: 2px 5px; border-radius: 4px; font-weight: bold;">SOS DETECTED</span>
            `;
            alertBox.style.display = 'block';

            // Sound
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            osc.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
        }
    } catch (e) {
        alertBox.style.display = 'block';
        details.innerText = "SOS SIGNAL RECEIVED!";
    }
}

window.dismissEmergency = () => {
    document.getElementById('emergency-alert').style.display = 'none';
};

function setupEmergencyListener() {
    supabaseClient.channel('tmo-emergency-channel')
        .on('postgres_changes', { event: 'INSERT', table: 'emergencies' }, payload => {
            showEmergencyAlert(payload.new);
            loadDashboardData();
        })
        .on('postgres_changes', { event: 'UPDATE', table: 'emergencies' }, payload => {
            loadDashboardData();
            if (payload.new.status === 'resolved') dismissEmergency();
        })
        .subscribe();
}

function setupActiveDriversListener() {
    supabaseClient.channel('tmo-drivers-channel')
        .on('postgres_changes', {
            event: '*',
            table: 'drivers'
        }, () => {
            // Refresh dashboard data whenever a driver status changes
            loadDashboardData();
        })
        .subscribe();
}

// --- GLOBAL ACTIONS ---

window.filterDrivers = async (filter) => {
    currentDriverFilter = filter;
    document.querySelectorAll('.view-switcher .switcher-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === filter);
    });
    await loadDrivers();
};

window.verifyDriver = (id) => {
    document.getElementById('modal-driver-id').value = id;
    document.getElementById('verifyModal').style.display = 'flex';
};

window.closeVerifyModal = () => {
    document.getElementById('verifyModal').style.display = 'none';
};

window.saveVerification = async () => {
    const id = document.getElementById('modal-driver-id').value;
    const permit = document.getElementById('modal-permit').value;
    const zone = document.getElementById('modal-zone').value;
    const inspection = document.getElementById('modal-inspection').value;

    try {
        await TMODashboard.verifyDriver(id, permit, zone, inspection);
        await showAlert('Driver Verified', 'The driver has been successfully verified and added to the official database.', 'success');
        window.closeVerifyModal();
        await loadDrivers();
        await loadDashboardData();
    } catch (e) {
        await showAlert('Verification Failed', e.message);
    }
};

window.sendBroadcast = async () => {
    const title = document.getElementById('broadcast-title').value;
    const message = document.getElementById('broadcast-message').value;
    const type = document.getElementById('broadcast-type').value;

    try {
        await TMODashboard.sendBroadcast(title, message, type);
        await showAlert('Broadcast Sent', 'Your alert has been broadcasted to all active drivers in the city.', 'success');
        document.getElementById('broadcast-title').value = '';
        document.getElementById('broadcast-message').value = '';
        await loadBroadcastsHistory();
    } catch (e) {
        await showAlert('Broadcast Error', e.message);
    }
};

window.deleteBroadcast = async (id) => {
    if (!confirm('Are you sure you want to delete this alert? Drivers will no longer see it.')) return;
    try {
        await TMODashboard.deleteBroadcast(id);
        await loadBroadcastsHistory();
    } catch (e) {
        await showAlert('Error', e.message);
    }
};

window.markResolved = async (id) => {
    try {
        await TMOEmergencies.dismissEmergency(id);
        await loadEmergencies();
        await loadDashboardData();
    } catch (e) {
        await showAlert('Sync Error', e.message);
    }
};

window.deleteEmergency = async (id) => {
    if (!confirm('Permanently delete this log?')) return;
    try {
        const { error } = await supabaseClient.from('emergencies').delete().eq('id', id);
        if (error) throw error;
        await loadEmergencies();
        await loadDashboardData();
    } catch (e) {
        await showAlert('Delete Error', e.message);
    }
};

window.deleteAllResolvedEmergencies = async () => {
    if (!confirm('Clear all resolved logs?')) return;
    try {
        await TMOEmergencies.clearAllResolved();
        await loadEmergencies();
        await loadDashboardData();
    } catch (e) {
        await showAlert('Clear Error', e.message);
    }
};

window.logout = async () => {
    await TMOAuth.logoutTMO();
};

// Start
init();
