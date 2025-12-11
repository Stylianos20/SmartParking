const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Für Overpass/OSRM
const db = require('../db'); // Zugriff auf die DB

// -------------------------------------------------------------
// HELPER FUNKTIONEN (Overpass und OSRM)
// -------------------------------------------------------------

/**
 * Ruft Parkplätze über die Overpass API ab (Beispielgebiet Frankfurt).
 */
async function getParkingSpotsFromOverpass() {
    const overpassQuery = `
        [out:json][timeout:25];
        (
            node["amenity"="parking"](50.1,8.6,50.15,8.7);
            way["amenity"="parking"](50.1,8.6,50.15,8.7);
        );
        out center;
    `;

    try {
        const response = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: overpassQuery
        });
        const data = await response.json();
        return data.elements.map(el => ({
            type: el.type,
            name: el.tags ? el.tags.name : "Unbekannter Parkplatz",
            lat: el.lat || (el.center ? el.center.lat : null),
            lon: el.lon || (el.center ? el.center.lon : null)
        }));
    } catch (error) {
        console.error("Overpass API Fehler:", error.message);
        return [];
    }
}

/**
 * Berechnet Fahrstrecke und Dauer über OSRM.
 */
async function getRouteDistance(startLon, startLat, endLon, endLat) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=false`;
    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();
        if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
            throw new Error(`OSRM Fehler: ${data.message || "Keine Route gefunden"}`);
        }
        return {
            distance: data.routes[0].distance,
            duration: data.routes[0].duration
        };
    } catch (error) {
        console.error("OSRM API Fehler:", error.message);
        throw new Error("Fehler bei der Streckenberechnung.");
    }
}


// -------------------------------------------------------------
// API ENDPUNKTE (Allgemein)
// -------------------------------------------------------------

// GET /api/spots - Alle Parkplätze aus DB (Voller Pfad: /parking/api/spots)
router.get('/api/spots', async (req, res) => {
    try {
        const spots = await db.getAllSpots();
        res.json(spots);
    } catch (error) {
        console.error("Fehler beim Abrufen der Parkplätze:", error.message);
        res.status(500).json({ message: "Interner Serverfehler beim Laden der Parkplätze." });
    }
});


// GET /nearest - Nächste Parkplätze inkl. Routing (Voller Pfad: /parking/nearest)
router.get('/nearest', async (req, res) => {
    const { startLat, startLon } = req.query;
    if (!startLat || !startLon) {
        return res.status(400).json({ error: "Bitte Startkoordinaten (startLat, startLon) angeben." });
    }

    try {
        const spots = await getParkingSpotsFromOverpass();
        if (spots.length === 0) {
            return res.status(404).json({ message: "Keine Parkplätze in diesem Gebiet gefunden." });
        }

        const routingPromises = spots.map(async spot => {
            try {
                const info = await getRouteDistance(startLon, startLat, spot.lon, spot.lat);
                return {
                    ...spot,
                    distanceMeters: info.distance,
                    durationSeconds: info.duration,
                    distanceKm: (info.distance / 1000).toFixed(1) + " km"
                };
            } catch (error) {
                console.warn(`Routing-Fehler für ${spot.name}: ${error.message}`);
                return { ...spot, error: "Routing fehlgeschlagen" };
            }
        });

        const spotsWithRoutes = await Promise.all(routingPromises);
        const sorted = spotsWithRoutes.filter(s => !s.error)
                                     .sort((a,b) => a.distanceMeters - b.distanceMeters)
                                     .slice(0,5);

        res.json({ startLocation: { lat: startLat, lon: startLon }, nearestParkingSpots: sorted });

    } catch (error) {
        console.error("Kombinierter API-Fehler:", error);
        res.status(500).json({ message: "Interner Serverfehler." });
    }
});


// -------------------------------------------------------------
// ANSICHTS-ENDPUNKTE
// -------------------------------------------------------------

// GET / (Voller Pfad: /parking)
router.get('/', (req, res) => {
    res.render('parking', { title: "Parkplatz-Status", user: req.session.user });
});

module.exports = router;
