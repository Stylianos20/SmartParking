
function displayStatus(message, isSuccess = true) {
    const statusArea = document.getElementById('status-message');
    const titleElement = document.getElementById('status-title');
    const textElement = document.getElementById('status-text');

    statusArea.classList.remove('hidden', 'bg-red-100', 'border-red-400', 'text-red-700', 'bg-green-100', 'border-green-400', 'text-green-700');

    if (isSuccess) {
        statusArea.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
        titleElement.textContent = "Erfolg!";
    } else {
        statusArea.classList.add('bg-red-100', 'border-red-400', 'text-red-700');
        titleElement.textContent = "Fehler!";
    }
    textElement.textContent = message;

    statusArea.classList.remove('hidden');
    setTimeout(() => statusArea.classList.add('hidden'), 5000);
}


const locale = 'de-DE';
const dateFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };

// DOM-Elemente
const listContainer = document.getElementById('reservations-list');
const emptyState = document.getElementById('empty-state');
const messageContainer = document.getElementById('message-container');
const modal = document.getElementById('confirmation-modal');
const confirmReleaseBtn = document.getElementById('confirm-release-btn');
const cancelBtn = document.getElementById('cancel-btn');

let currentReservationToRelease = null;

function parseServerReservations() {
    try {
        const raw = listContainer.dataset.reservations;
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Fehler beim Parsen der Server-Daten:', e);
        return [];
    }
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleDateString(locale, dateFormatOptions);
}

function displayMessage(message, isSuccess = true) {
    messageContainer.innerHTML = `
        <div class="p-4 rounded-xl shadow-md ${isSuccess ? 'bg-green-100 border-l-4 border-green-500 text-green-700' : 'bg-red-100 border-l-4 border-red-500 text-red-700'}" role="alert">
            <p class="font-bold">${isSuccess ? 'Erfolg' : 'Fehler'}</p>
            <p>${message}</p>
        </div>
    `;
    setTimeout(() => { messageContainer.innerHTML = ''; }, 5000);
}

function createReservationItem(reservation) {
    let statusText, statusClasses, actionButton = '';
    const reservationId = reservation.id || reservation.pk || 'Unbekannt';
    const spotId = reservation.spotId || 'N/A';

    switch (reservation.status) {
        case 'active':
            statusText = 'AKTIV';
            statusClasses = 'bg-blue-100 text-blue-600';
            actionButton = `<button 
                class="release-button px-3 py-1 bg-red-600 text-white text-sm font-medium rounded-lg shadow-md hover:bg-red-700 transition duration-150"
                data-reservation-id="${reservationId}"
                data-spot-id="${spotId}">
                Reservierung stornieren
            </button>`;
            break;
        case 'completed':
            statusText = 'ABGESCHLOSSEN';
            statusClasses = 'bg-green-100 text-green-600';
            break;
        case 'cancelled':
            statusText = 'STORNIERT';
            statusClasses = 'bg-orange-100 text-orange-600';
            break;
        default:
            statusText = 'UNBEKANNT';
            statusClasses = 'bg-gray-100 text-gray-500';
    }

    return `
        <div class="reservation-item bg-white border border-gray-200 rounded-xl p-5 shadow-lg transition duration-200 hover:shadow-xl">
            <div class="flex justify-between items-center border-b pb-3 mb-3 border-gray-100">
                <h4 class="text-lg font-semibold text-gray-800">Parkplatz-ID: ${spotId}</h4>
                <span class="px-3 py-1 text-xs font-bold rounded-full ${statusClasses}">${statusText}</span>
            </div>

            <p class="text-sm text-gray-500 mt-1">Reserviert von: <span class="font-semibold text-gray-700">${formatTime(reservation.startTime)}</span></p>
            <p class="text-sm text-gray-500 mt-1">Voraussichtliches Ende: <span class="font-semibold text-gray-700">${formatTime(reservation.endTime)}</span></p>
            <p class="text-sm text-gray-500 mt-1">Reservierungs-ID: <span class="font-semibold text-gray-700">${reservationId}</span></p>

            <div class="mt-4">${actionButton}</div>
        </div>
    `;
}

function addReleaseButtonListeners() {
    document.querySelectorAll('.release-button').forEach(button => {
        button.addEventListener('click', (event) => {
            const resId = event.currentTarget.dataset.reservationId;
            const spId = event.currentTarget.dataset.spotId;
            currentReservationToRelease = { resId, spId };
            document.getElementById('modal-spot-id').textContent = spId;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        });
    });
}

async function executeRelease(reservationId, spotId) {
    if (!reservationId || !spotId) {
        displayMessage("Fehler: Reservierungs-ID oder Parkplatz-ID fehlt.", false);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        return;
    }

    confirmReleaseBtn.disabled = true;
    confirmReleaseBtn.innerHTML = 'Wird freigegeben';
    messageContainer.innerHTML = '';

    const payload = { reservationId, spotId };
    console.log("DEBUG: Sende Payload zur Stornierung:", payload);

    try {
        const response = await fetch('/parking/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok) {
            displayMessage(data.message || "Parkplatz erfolgreich freigegeben und Reservierung storniert!", true);
            setTimeout(() => window.location.reload(), 1000);
        } else {
            const errorMessage = data.message || `Status: ${response.status} ${response.statusText}`;
            displayMessage(`Stornierung fehlgeschlagen: ${errorMessage}`, false);
            console.error('Server-Antwort Fehler:', data);
        }
    } catch (error) {
        console.error("Fetch Fehler:", error);
        displayMessage("Netzwerkfehler beim Stornieren der Reservierung. Überprüfen Sie die Konsole.", false);
    } finally {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        confirmReleaseBtn.disabled = false;
        confirmReleaseBtn.innerHTML = 'Freigeben';
    }
}

function renderReservations(reservations) {
    const validReservations = Array.isArray(reservations) ? reservations.filter(r => r && r.id) : [];
    if (validReservations.length === 0) {
        listContainer.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    const activeReservations = validReservations
        .filter(r => r.status === 'active')
        .sort((a, b) => b.startTime - a.startTime);
    const otherReservations = validReservations
        .filter(r => r.status === 'completed' || r.status === 'cancelled')
        .sort((a, b) => b.startTime - a.startTime);

    listContainer.innerHTML = [
        ...activeReservations, 
        ...otherReservations
    ].map(createReservationItem).join('');

    addReleaseButtonListeners();
}


// Modal Event Listener
cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentReservationToRelease = null;
});

confirmReleaseBtn.addEventListener('click', () => {
    if (currentReservationToRelease) {
        executeRelease(currentReservationToRelease.resId, currentReservationToRelease.spId);
    }
});

// Start
document.addEventListener('DOMContentLoaded', () => {
    const reservations = parseServerReservations();
    renderReservations(reservations);
});

// ----------------------------------------------------------------------
// RESERVIERUNGSFUNKTIONEN
// ----------------------------------------------------------------------


export { displayStatus, formatTime, renderReservations, executeRelease ,parseServerReservations ,createReservationItem ,displayMessage ,addReleaseButtonListeners };

