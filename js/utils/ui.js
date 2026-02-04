
// UI Utilities - Handles simple DOM updates

export function updateAvatarUI(url) {
    const containers = ['header-avatar', 'disp-avatar-container', 'edit-avatar-preview'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;

        const icon = container.querySelector('i');
        let img = container.querySelector('img');

        if (url) {
            if (!img) {
                img = document.createElement('img');
                container.appendChild(img);
            }
            img.src = url;
            img.style.display = 'block';
            if (icon) icon.style.display = 'none';
        } else {
            if (img) img.style.display = 'none';
            if (icon) icon.style.display = 'block';
        }
    });
}

export function updateStatusUI(status) {
    const btn = document.getElementById('online-toggle');
    const statusTitle = document.querySelector('.status-card h2');
    const statusCard = document.querySelector('.status-card');

    if (status === 'online') {
        btn.innerText = 'Go Offline';
        statusTitle.innerText = 'Available';
        statusCard.style.background = '#10b981'; // Green
    } else {
        btn.innerText = 'Go Online';
        statusTitle.innerText = 'Offline';
        statusCard.style.background = '#64748b'; // Slate
    }
}

export function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const container = document.getElementById('edit-avatar-preview');
            const icon = container.querySelector('i');
            let img = container.querySelector('img');

            if (!img) {
                img = document.createElement('img');
                container.appendChild(img);
            }
            img.src = e.target.result;
            img.style.display = 'block';
            if (icon) icon.style.display = 'none';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

export function applyTheme(hexColor) {
    if (!hexColor) return;

    // Convert Hex to HSL for intelligent lightening
    let r = parseInt(hexColor.slice(1, 3), 16) / 255;
    let g = parseInt(hexColor.slice(3, 5), 16) / 255;
    let b = parseInt(hexColor.slice(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max == min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    h = Math.round(h * 360);
    s = Math.round(s * 100);

    // Create eye-friendly light versions (improved visibility & zero pink tint)
    const bgColor = `hsl(${h}, ${Math.min(s, 15)}%, 92%)`; // Very desaturated background
    const barColor = `hsl(${h}, ${Math.min(s, 10)}%, 98%)`; // Near-white bar
    const primaryColor = hexColor;
    const hoverColor = `hsl(${h}, ${s}%, 30%)`;

    // 1. Update Global Variables
    document.documentElement.style.setProperty('--primary', primaryColor);
    document.documentElement.style.setProperty('--primary-hover', hoverColor);
    // Optional: if you want to replace secondary too
    document.documentElement.style.setProperty('--secondary', primaryColor);

    // 2. Update Specific Layout Elements
    const layout = document.getElementById('mobile-layout-container');
    if (layout) layout.style.background = bgColor;

    const headers = document.querySelectorAll('.app-header, .driver-header');
    headers.forEach(el => el.style.background = barColor);

    const navbars = document.querySelectorAll('.navbar');
    navbars.forEach(el => el.style.background = barColor);

    // 3. Clean up hardcoded pinks/accents
    const profileContainers = document.querySelectorAll('#profile-btn, .profile-avatar, .driver-avatar, .avatar, .req-avatar');
    profileContainers.forEach(el => {
        el.style.background = barColor;
        el.style.borderColor = `hsl(${h}, ${Math.min(s, 30)}%, 85%)`;
        const icon = el.querySelector('i');
        if (icon) icon.style.color = primaryColor;
    });

    // 4. Update specific buttons/banners
    const requestBtn = document.getElementById('request-btn');
    if (requestBtn) {
        requestBtn.style.background = `linear-gradient(90deg, ${primaryColor}, ${hoverColor})`;
    }

    const sosBanner = document.getElementById('sos-banner');
    if (sosBanner) {
        sosBanner.style.background = barColor;
        sosBanner.style.borderColor = `hsl(${h}, ${Math.min(s, 30)}%, 90%)`;
    }
}

export function activateSOSUI(isDriver = false) {
    let overlay = document.getElementById('sos-active-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sos-active-overlay';


        if (isDriver) {
            // Banner style for drivers - doesn't block the dashboard
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 100%;
                max-width: 480px;
                background: rgba(220, 38, 38, 0.98);
                z-index: 9999;
                display: flex;
                flex-direction: column;
                align-items: center;
                color: white;
                text-align: center;
                padding: 20px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                animation: sosPulse 1.5s infinite;
            `;
        } else {
            // Same banner style for passengers
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 100%;
                max-width: 480px;
                background: rgba(220, 38, 38, 0.98);
                z-index: 9999;
                display: flex;
                flex-direction: column;
                align-items: center;
                color: white;
                text-align: center;
                padding: 20px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                animation: sosPulse 1.5s infinite;
            `;
        }

        if (!document.getElementById('sos-animation-style')) {
            const style = document.createElement('style');
            style.id = 'sos-animation-style';
            style.innerHTML = `
                @keyframes sosPulse {
                    0% { background: rgba(220, 38, 38, 0.98); }
                    50% { background: rgba(153, 27, 27, 1); }
                    100% { background: rgba(220, 38, 38, 0.98); }
                }
            `;
            document.head.appendChild(style);
        }

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <i class='bx bxs-error-alt' style="font-size: 40px;"></i>
                <div style="text-align: left;">
                    <h1 style="font-size: 20px; font-weight: 900; margin: 0 0 5px 0;">🚨 SOS ACTIVATED</h1>
                    <p style="font-size: 14px; line-height: 1.4; margin: 0;">
                        ${isDriver ? 'A PASSENGER HAS TRIGGERED AN EMERGENCY!' : 'EMERGENCY SIGNAL SENT TO TMO & AUTHORITIES'}
                    </p>
                </div>
            </div>
            <div style="display: flex; gap: 10px; width: 100%;">
                <a href="tel:911" style="flex: 1; background: white; color: #dc2626; padding: 12px; border-radius: 12px; font-weight: 700; text-decoration: none; display: block; font-size: 14px; text-align: center;">📞 CALL 911</a>
                <button onclick="document.getElementById('sos-active-overlay').remove()" 
                    style="flex: 1; background: transparent; border: 2px solid white; color: white; padding: 12px; border-radius: 12px; font-weight: 600; cursor: pointer; font-size: 14px;">Dismiss</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }
}

/**
 * Premium Replacement for window.confirm()
 * Usage: const confirmed = await showConfirm("Message...");
 */
export function showConfirm(message) {
    return new Promise((resolve) => {
        // Create Overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(15, 23, 42, 0.4);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            padding: 24px;
            animation: fadeInConfirm 0.2s ease-out;
        `;

        if (!document.getElementById('confirm-animation-style')) {
            const style = document.createElement('style');
            style.id = 'confirm-animation-style';
            style.innerHTML = `
                @keyframes fadeInConfirm { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleInConfirm { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            `;
            document.head.appendChild(style);
        }

        // Create Card
        const card = document.createElement('div');
        card.style.cssText = `
            background: white;
            width: 100%;
            max-width: 320px;
            border-radius: 28px;
            padding: 32px 24px 24px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            animation: scaleInConfirm 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

        card.innerHTML = `
            <div style="width: 56px; height: 56px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <i class='bx bx-question-mark' style="font-size: 28px; color: #64748b;"></i>
            </div>
            <p style="font-size: 16px; font-weight: 600; color: #1e293b; line-height: 1.5; margin-bottom: 28px;">${message}</p>
            <div style="display: flex; gap: 12px;">
                <button id="confirm-cancel" style="flex: 1; height: 48px; background: #f1f5f9; color: #64748b; border: none; border-radius: 14px; font-weight: 700; font-size: 14px; cursor: pointer;">Cancel</button>
                <button id="confirm-ok" style="flex: 1; height: 48px; background: var(--primary); color: white; border: none; border-radius: 14px; font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">Confirm</button>
            </div>
        `;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // Events
        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
            resolve(val);
        };

        overlay.querySelector('#confirm-cancel').onclick = () => cleanup(false);
        overlay.querySelector('#confirm-ok').onclick = () => cleanup(true);
        // Also allow clicking backdrop to cancel
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
}
