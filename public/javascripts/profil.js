// nav-Funktion für die Tabs
function nav(event, target) {
    // 1. Alle Tabs und Buttons säubern
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none'; // Alles verstecken
    });
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));

    // 2. Ziel-Tab aktivieren
    const section = document.getElementById('section-' + target);
    if (section) {
        section.classList.add('active');
        section.style.display = 'block'; // Ziel anzeigen
    }

    // 3. Button-Styling (nur wenn event vorhanden oder manuell gesucht)
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        // Falls kein Klick-Event da ist (Automatik), suchen wir den passenden Button
        const btn = Array.from(document.querySelectorAll('.menu-btn'))
                         .find(b => b.getAttribute('onclick')?.includes(target));
        if (btn) btn.classList.add('active');
    }
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

// Hilfsfunktion: Prüft den URL-Anker (#) und schaltet den Tab um
function checkHashAndSwitchTab() {
    const currentHash = window.location.hash.toLowerCase();
    
    // Prüft auf #reserve oder #reservations (passend zu deiner ID section-reserve)
    if (currentHash === '#reservations' || currentHash === '#reserve') {
        console.log("Hash-Wechsel erkannt: Schalte auf Reservierungen um.");
        
        // Wir nutzen deine nav-Funktion. 
        // Wir suchen den Button in der Sidebar, der 'reserve' im onclick hat.
        const resBtn = Array.from(document.querySelectorAll('.menu-btn'))
                            .find(btn => btn.getAttribute('onclick')?.includes('reserve'));
        
        // Tab umschalten
        nav({ currentTarget: resBtn }, 'reserve');
        
        // Filter auf 'Aktiv' setzen
        if (typeof filterReservations === 'function') {
            filterReservations('active');
        }
    }
}

// EVENT LISTENER 1: Beim ersten Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
    console.log("Seite geladen. Prüfe initialen Hash...");
    checkHashAndSwitchTab();
    
    // Dein Standard-Filter (falls kein Hash vorhanden ist)
    if (!window.location.hash) {
        filterReservations('active');
    }
});

// EVENT LISTENER 2: Wenn sich der Hash ändert, während man auf der Seite bleibt
// Das löst dein Problem beim erneuten Klicken auf den Nav-Link oben!
window.addEventListener('hashchange', () => {
    console.log("URL-Hash hat sich geändert.");
    checkHashAndSwitchTab();
});