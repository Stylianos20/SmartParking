// Globale Variablen für Karte und Status
let map;
let parkingMarkers = L.layerGroup();
const API_BASE_URL = '/parking/api';

// Diese Variablen werden von der EJS-Vorlage gesetzt.
let currentUserId = window.__expressUserId || null;
let isLoggedIn = window.__isLoggedIn || false;

// Alle Spots für Details speichern
let allParkingSpots = [];

// Funktionen global verfügbar machen für Popups/UI-Handler
window.reserveSpotFromMap = reserveSpot;
window.showSpotDetails = showSpotDetails;
window.releaseSpotFromUI = releaseSpot; 

// =======================================================
// 1. Status- und API-Funktionen
// =======================================================

/**
 * Zeigt eine Statusmeldung im UI an.
 */
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

/**
 * Ruft alle Parkplätze ab und speichert sie lokal.
 */
async function getAllSpots() {
    const response = await fetch(`${API_BASE_URL}/spots`);
    if (!response.ok) throw new Error(`Netzwerk- oder Serverfehler: ${response.status}`);
    const spots = await response.json();
    allParkingSpots = spots;
    return spots;
}

/**
 * Reserviert einen Parkplatz über die API.
 * @param {string} spotId - Die ID des Parkplatzes.
 */
async function reserveSpot(spotId) {
    if (!isLoggedIn) {
        displayStatus("Sie müssen angemeldet sein, um einen Parkplatz zu reservieren.", false);
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spotId }),
        });

        const result = await response.json();

        if (response.ok) {
            displayStatus(result.message || `Parkplatz ${spotId} erfolgreich reserviert!`, true);
        } else {
            // Hier fangen wir den echten Server-Fehler ab
            displayStatus(result.error || "Reservierung fehlgeschlagen.", false);
        }
    } catch (error) {
        console.error("Fehler bei Reservierung:", error);
        displayStatus("Ein unerwarteter Fehler ist bei der Reservierung aufgetreten.", false);
    } finally {
        // Immer danach die Spots neu laden, damit UI aktuell ist
        await loadParkingSpots();
    }
}



/**
 * Gibt die aktive Reservierung frei. Die IDs werden serverseitig aus der Session gelesen.
 */
async function releaseSpot(spotId) { // <-- Hier spotId hinzufügen
    if (!confirm(`Sind Sie sicher, dass Sie den Parkplatz ${spotId} freigeben möchten?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Schick die spotId im Body mit, damit der Server Bescheid weiß
            body: JSON.stringify({ spotId: spotId }) 
        });

        const result = await response.json();

        if (response.ok) {
            window.location.reload(); 
        } else {
            alert(result.message || "Fehler beim Freigeben.");
        }
    } catch (error) {
        console.error("Fehler:", error);
    }
}


// =======================================================
// 2. Karten- und UI-Funktionen
// =======================================================

function initializeMap() {
        const bounds = L.latLngBounds(
        [50.29, 8.69], // ~5 km Süd-West
        [50.37, 8.81]  // ~5 km Nord-Ost
    );
    map = L.map('mapid', {
        maxBounds: bounds,
        maxBoundsViscosity: 1.0,
        minZoom: 12,
    }).setView([50.33084440448259, 8.751109034916668], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    parkingMarkers.addTo(map);
}

function showSpotDetails(spotId) {
    const spot = allParkingSpots.find(s => s.id === spotId);
    if (!spot) return;

    const detailContainer = document.getElementById('parking-details');
    document.getElementById('detail-title').textContent = spot.name;

    const openingHours = spot.openingHours
        ? Object.entries(spot.openingHours).map(([day, hours]) => `<li><strong>${capitalize(day)}:</strong> ${hours}</li>`).join('')
        : '<li>Keine Öffnungszeiten verfügbar</li>';

    document.getElementById('detail-content').innerHTML = `
        <p class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Allgemein</strong><br>
            Typ: ${spot.type || 'Standard'}<br>
            Adresse: ${spot.location || 'Unbekannt'}<br>
            Max. Höhe: ${spot.maxHeight ?? '-'} m
        </p>
        <p class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Kapazität</strong><br>
            Gesamtplätze: ${spot.totalCount ?? 'Unbekannt'}<br>
            Verfügbare Parkplätze: ${spot.availableCount ?? 'Unbekannt'}<br>
            Behindertenstellplätze: ${spot.disabledSpots ?? 0}<br>
            EV-Ladestationen: ${spot.evChargingCount ?? 0} (${spot.evChargingTypes?.join(', ') || '-'})
        </p>
        <p class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Preise & Bezahlung</strong><br>
            Preis/Std: ${spot.pricePerHour?.toFixed(2) ?? '0.00'} €<br>
            Zahlungsmethoden: ${spot.paymentMethods?.join(', ') || 'Keine Angaben'}
        </p>
        <p class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Extras</strong><br>
            Barrierefrei: ${spot.barrierFree ? 'Ja' : 'Nein'}<br>
            Überwachung: ${spot.surveillance ? 'Ja' : 'Nein'}
        </p>
        <div class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Öffnungszeiten:</strong>
            <ul>${openingHours}</ul>
        </div>
        <p class="mt-4 p-3 bg-white rounded shadow-sm">
            <strong>Beschreibung</strong><br>
            ${spot.description || 'Keine detaillierte Beschreibung verfügbar.'}
        </p>
    `;

    detailContainer.classList.remove('hidden');
    detailContainer.scrollIntoView({ behavior: 'smooth' });

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

function updateMapMarkers(spots) {
    if (!map) return;
    if (!parkingMarkers || typeof parkingMarkers.clearLayers !== 'function') parkingMarkers = L.layerGroup().addTo(map);

    parkingMarkers.clearLayers();

    spots.forEach((spot) => {
        const lat = Number(spot.lat);
        const lon = Number(spot.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;

        const availableCount = Number(spot.availableCount ?? 0);
        const totalCount = spot.totalCount ?? 'N/A';
        const isFull = availableCount <= 0;
        const markerColor = isFull ? 'red' : 'green';

        const reserveButton = (!isFull && isLoggedIn)
            ? `<button class="text-blue-600 hover:text-blue-800 ml-2" onclick="reserveSpotFromMap('${spot.id}')">Reservieren</button>`
            : `<button class="text-gray-400 ml-2" disabled>Reservieren</button>`;

        const popupHtml = `
            <h4 class="font-bold">${spot.name ?? 'Unbenannt'}</h4>
            <p class="text-sm">Freie Plätze: <span style="color:${markerColor};font-weight:bold">${availableCount}</span> von ${totalCount}</p>
            <p class="text-xs mt-1">${spot.street || 'Unbekannt'} ${spot.houseNumber||''}, ${spot.zip||''} ${spot.city||''}</p>
            <div class="mt-2">
                <button class="text-blue-600 hover:text-blue-800" onclick="showSpotDetails('${spot.id}')">Details</button>
                ${reserveButton}
            </div>
        `;

        L.marker([lat, lon]).bindPopup(popupHtml).addTo(parkingMarkers);
    });

    if (parkingMarkers.getLayers().length > 0 && typeof parkingMarkers.getBounds === 'function') {
        map.fitBounds(parkingMarkers.getBounds(), { padding: [50, 50] });
    }
}

function createSpotCard(spot) {
    const availableCount = spot.availableCount ?? 0;
    const isFull = availableCount <= 0;
    const price = (spot.pricePerHour || 0).toFixed(2);
    const isReservable = !isFull && isLoggedIn;
    const buttonText = isFull ? 'Ausgebucht' : (isReservable ? 'Jetzt reservieren' : 'Login zum Reservieren');
    const buttonClass = isReservable ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed';
    const availabilityClass = isFull ? 'text-red-500 font-bold' : 'text-green-600 font-bold';
    const availabilityText = isFull ? 'Belegt' : `Verfügbar (${availableCount} Plätze)`;

    return `
        <div id="spot-${spot.id}" class="bg-white p-5 rounded-xl shadow-lg hover:shadow-xl transition duration-300 border border-gray-100">
            <div class="flex justify-between items-start mb-3">
                <h3 class="text-lg font-semibold text-gray-800">${spot.name}</h3>
                <span class="text-xs font-medium px-2 py-0.5 rounded-full ${spot.type === 'Premium' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">${spot.type || 'Standard'}</span>
            </div>
            <p class="text-sm text-gray-500 mb-2">${spot.location}</p>
            <p class="text-sm text-gray-700 mb-4">Preis: <strong>${price} €/Std.</strong></p>
            <p class="mb-4">
                Status: 
                <span class="${availabilityClass} font-bold">${availabilityText}</span> 
            </p>
            <div class="flex space-x-2">
                <button data-spot-id="${spot.id}" class="js-details-btn flex-grow bg-gray-300 text-gray-800 hover:bg-gray-400 p-2 rounded-md transition duration-150">Details</button>
                <button data-spot-id="${spot.id}" class="js-reserve-btn flex-grow ${buttonClass} p-2 rounded-md transition duration-150">${buttonText}</button>
            </div>
        </div>
    `;
}

async function loadParkingSpots() {
    const listContainer = document.getElementById('parking-list');
    const loadingIndicator = document.getElementById('loading');
    const errorArea = document.getElementById('error-message');
    const noSpotsMessage = document.getElementById('no-spots-message');

    listContainer.innerHTML = '';
    loadingIndicator.classList.remove('hidden');
    errorArea.classList.add('hidden');
    noSpotsMessage.classList.add('hidden');
    applyFilters();

    try {
        const spots = await getAllSpots();
        loadingIndicator.classList.add('hidden');
        updateMapMarkers(spots);

        // Filtert Spots, die mindestens einen Platz frei haben
        const availableSpots = spots.filter(spot => (spot.availableCount ?? 0) > 0);

        if (availableSpots.length > 0) {
            listContainer.innerHTML = availableSpots.map(createSpotCard).join('');

            listContainer.querySelectorAll('button.js-reserve-btn').forEach(button => {
                // Nur Buttons aktivieren, wenn der Benutzer eingeloggt und der Platz frei ist
                if (isLoggedIn && !button.textContent.includes('Ausgebucht')) {
                    button.addEventListener('click', (e) => reserveSpot(e.currentTarget.dataset.spotId));
                }
            });

            listContainer.querySelectorAll('button.js-details-btn').forEach(button => {
                button.addEventListener('click', (e) => showSpotDetails(e.currentTarget.dataset.spotId));
            });

        } else {
            noSpotsMessage.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Fehler beim Laden der Parkplätze:", error.message);
        loadingIndicator.classList.add('hidden');
        document.getElementById('error-text').textContent = "Fehler beim Abrufen der Parkplatzdaten.";
        errorArea.classList.remove('hidden');
    }

    
}


let filterPaid = true;    // true = kostenpflichtige zeigen
let filterFree = true;    // true = kostenlose zeigen

// Funktion, um Filter zu setzen
function setParkingFilters({ free = true, paid = true }) {
    filterFree = free;
    filterPaid = paid;
    applyFilters();
}

// Filter anwenden: Update Marker & Liste
function applyFilters() {
    if (!allParkingSpots || !allParkingSpots.length) return;

    const filteredSpots = allParkingSpots.filter(spot => {
        const isPaid = spot.pricePerHour && spot.pricePerHour > 0;
        if (isPaid && filterPaid) return true;
        if (!isPaid && filterFree) return true;
        return false;
    });

    updateMapMarkersWithFilter(filteredSpots);
    updateListWithFilter(filteredSpots);
}

function updateMapMarkersWithFilter(spots) {
    if (!map) return;
    parkingMarkers.clearLayers();

    allParkingSpots.forEach(spot => {
        const lat = Number(spot.lat);
        const lon = Number(spot.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;

        const availableCount = Number(spot.availableCount ?? 0);
        const isFull = availableCount <= 0;
        const isPaid = spot.pricePerHour && spot.pricePerHour > 0;

        let markerColor = 'gray'; // default ausgeblendet
        if ((isPaid && filterPaid) || (!isPaid && filterFree)) {
            markerColor = isFull ? 'red' : 'green';
        }

        const reserveButton = (!isFull && isLoggedIn && markerColor !== 'gray')
            ? `<button class="text-blue-600 hover:text-blue-800 ml-2" onclick="reserveSpotFromMap('${spot.id}')">Reservieren</button>`
            : `<button class="text-gray-400 ml-2" disabled>Reservieren</button>`;

        const popupHtml = `
            <h4 class="font-bold">${spot.name ?? 'Unbenannt'}</h4>
            <p class="text-sm">Freie Plätze: <span style="color:${markerColor};font-weight:bold">${availableCount}</span> von ${spot.totalCount ?? 'N/A'}</p>
            <p class="text-xs mt-1">${spot.street || 'Unbekannt'} ${spot.houseNumber||''}, ${spot.zip||''} ${spot.city||''}</p>
            <div class="mt-2">
                <button class="text-blue-600 hover:text-blue-800" onclick="showSpotDetails('${spot.id}')">Details</button>
                ${reserveButton}
            </div>
        `;

        L.marker([lat, lon], { opacity: markerColor === 'gray' ? 0.5 : 1 })
            .bindPopup(popupHtml)
            .addTo(parkingMarkers);
    });

    if (parkingMarkers.getLayers().length > 0 && typeof parkingMarkers.getBounds === 'function') {
        map.fitBounds(parkingMarkers.getBounds(), { padding: [50, 50] });
    }
}

// Liste Update mit Filterfarbe
function updateListWithFilter(filteredSpots) {
    const listContainer = document.getElementById('parking-list');
    listContainer.innerHTML = allParkingSpots.map(spot => {
        const isFiltered = filteredSpots.includes(spot);
        const availableCount = spot.availableCount ?? 0;
        const isFull = availableCount <= 0;
        const isReservable = isLoggedIn && !isFull && isFiltered;
        const price = (spot.pricePerHour || 0).toFixed(2);
        const buttonClass = isReservable
            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed';
        const disabledAttr = isReservable ? '' : 'disabled';
        const availabilityClass = isFull ? 'text-red-500 font-bold' : 'text-green-600 font-bold';
        const availabilityText = isFull ? 'Belegt' : `Verfügbar (${availableCount} Plätze)`;
        const buttonText = isFull ? 'Ausgebucht' : (isReservable ? 'Jetzt reservieren' : 'Login zum Reservieren');

        return `
            <div id="spot-${spot.id}" class="bg-white p-5 rounded-xl shadow-lg hover:shadow-xl transition duration-300 border border-gray-100">
                <div class="flex justify-between items-start mb-3">
                    <h3 class="text-lg font-semibold text-gray-800">${spot.name}</h3>
                    <span class="text-xs font-medium px-2 py-0.5 rounded-full ${spot.type === 'Premium' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">${spot.type || 'Standard'}</span>
                </div>
                <p class="text-sm text-gray-500 mb-2">${spot.location}</p>
                <p class="text-sm text-gray-700 mb-4">Preis: <strong>${price} €/Std.</strong></p>
                <p class="mb-4">
                    Status: <span class="${availabilityClass} font-bold">${availabilityText}</span>
                </p>
                <div class="flex space-x-2">
                    <button data-spot-id="${spot.id}" class="js-details-btn flex-grow bg-gray-300 text-gray-800 hover:bg-gray-400 p-2 rounded-md transition duration-150">Details</button>
                    <button data-spot-id="${spot.id}" class="js-reserve-btn flex-grow ${buttonClass} p-2 rounded-md transition duration-150" ${disabledAttr}>${buttonText}</button>
                </div>
            </div>
        `;
    }).join('');

    listContainer.querySelectorAll('button.js-reserve-btn').forEach(button => {
        if (!button.disabled) {
            button.addEventListener('click', e => reserveSpot(e.currentTarget.dataset.spotId));
        }
    });

    listContainer.querySelectorAll('button.js-details-btn').forEach(button => {
        button.addEventListener('click', e => showSpotDetails(e.currentTarget.dataset.spotId));
    });
}
window.setParkingFilters = setParkingFilters;



// =======================================================
// 3. Initialisierung
// =======================================================

document.addEventListener('DOMContentLoaded', async () => {
    const closeBtn = document.getElementById('close-details-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('parking-details').classList.add('hidden');
    });

    initializeMap();
    loadParkingSpots();
});

// Machen Sie `releaseSpot` global verfügbar, falls es von EJS-Templates benötigt wird.
window.releaseSpot = releaseSpot;