// nav-Funktion für die Tabs
function nav(event, target) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('section-' + target).classList.add('active');
    event.currentTarget.classList.add('active');
}

// Live-Uhrzeit
setInterval(() => {
    const el = document.getElementById('liveTime');
    if (el) {
        const now = new Date();
        el.innerText = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    }
}, 1000);

let currentSpotId = null;
let currentReservationId = null;

// Modal öffnen
function openReleaseModal(spotId, reservationId) {
    currentSpotId = spotId;
    currentReservationId = reservationId;
    const modal = document.getElementById('confirmation-modal');
    if (modal) {
        document.getElementById('modal-spot-id').innerText = spotId;
        modal.classList.remove('hidden');
    }
}

// Modal schließen Event-Listener
document.getElementById('close-modal-btn')?.addEventListener('click', () => {
    document.getElementById('confirmation-modal').classList.add('hidden');
});

// Bestätigung im Modal
document.getElementById('confirm-release-btn')?.addEventListener('click', async () => {
    try {
        const response = await fetch('/parking/api/release', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spotId: currentSpotId, reservationId: currentReservationId })
        });
        if (response.ok) window.location.reload();
        else alert("Fehler beim Freigeben");
    } catch (err) {
        alert("Netzwerkfehler.");
    }
});

// Schranken Logik
async function handleGate(type) {
    const plateInput = document.getElementById(type === 'entry' ? 'entryPlate' : 'exitPlate');
    const spotSelect = document.getElementById(type === 'entry' ? 'entrySpotSelect' : 'exitSpotSelect');
    const statusDiv = document.getElementById('gateStatus');

    const plate = plateInput.value.trim().toUpperCase();
    const spotId = spotSelect.value;

    if (!plate || !spotId) return alert("Kennzeichen und Parkplatz prüfen!");

    try {
        const response = await fetch(`/parking/api/gate-${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plate, spotId })
        });
        const data = await response.json();
        statusDiv.style.display = 'block';
        if (response.ok) {
            statusDiv.innerHTML = `<p style="color: #3fb950;">✅ ${data.message}</p>`;
            if (data.invoice) {
                statusDiv.innerHTML += `<p>Dauer: ${data.invoice.duration} | Preis: ${data.invoice.price}</p>`;
            }
            setTimeout(() => window.location.reload(), 3000);
        } else {
            statusDiv.innerHTML = `<p style="color: #f85149;">❌ ${data.error}</p>`;
        }
    } catch (err) { alert("Fehler"); }
}

// Spots für das Kennzeichen laden
async function fetchMySpots(type) {
    const plate = document.getElementById(type === 'entry' ? 'entryPlate' : 'exitPlate').value.trim().toUpperCase();
    const select = document.getElementById(type === 'entry' ? 'entrySpotSelect' : 'exitSpotSelect');

    if (!plate) return alert("Bitte Kennzeichen eingeben!");

    try {
        const response = await fetch(`/parking/api/my-active-spots/${plate}`);
        let spots = await response.json();
        select.innerHTML = ''; 

        if (spots && !Array.isArray(spots)) spots = [spots];
        if (!spots || spots.length === 0 || spots[0].error) {
            select.innerHTML = '<option>Keine Reservierung gefunden</option>';
            return;
        }

        spots.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.spotId;
            opt.textContent = "📍 Platz: " + s.spotId;
            select.appendChild(opt);
        });
    } catch (err) { alert("Fehler beim Abrufen"); }
}


// ... (dein restlicher Code wie nav, handleGate etc.)

function filterReservations(status) {
    const cards = document.querySelectorAll('.reservation-item');
    const buttons = document.querySelectorAll('.filter-btn');

    // 1. Buttons umschalten
    buttons.forEach(btn => {
        btn.classList.remove('active');
        // Wir prüfen, ob der Status im onclick vorkommt
        if (btn.getAttribute('onclick')?.includes(`'${status}'`)) {
            btn.classList.add('active');
        }
    });

    // 2. Karten filtern
    cards.forEach(card => {
        const cardStatus = (card.getAttribute('data-status') || 'active').toLowerCase().trim();        
        const targetStatus = status.toLowerCase().trim();

        console.log(`Prüfe Karte: Status ist "${cardStatus}", Filter ist "${targetStatus}"`);

        // Logik für die Anzeige
        let show = false;
        if (targetStatus === 'all') {
            show = true;
        } else if (targetStatus === 'active' && cardStatus === 'active') {
            show = true;
        } else if (targetStatus === 'completed' && cardStatus === 'completed') {
            show = true;
        } else if (targetStatus === 'cancelled' && cardStatus === 'cancelled') {
            show = true;
        }

        if (show) {
            card.style.setProperty('display', 'flex', 'important');
        } else {
            card.style.setProperty('display', 'none', 'important');
        }
    });
}

// Wichtig: Diese Zuweisungen machen deine Funktionen für das HTML (onclick) sichtbar
window.nav = nav;
window.filterReservations = filterReservations;
window.handleGate = handleGate;
window.fetchMySpots = fetchMySpots;
window.openReleaseModal = openReleaseModal;

// Initialisierung beim Laden
document.addEventListener('DOMContentLoaded', () => {
    console.log("SmartParking Profile JS geladen und bereit.");
    filterReservations('active'); // Standardfilter setzen
});