// db.js

const crypto = require('crypto');
require('dotenv').config();
const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;

if (!endpoint || !key) {
    console.error('FEHLER: COSMOS_ENDPOINT oder COSMOS_KEY fehlt in den Umgebungsvariablen!');
}

const client = new CosmosClient({ endpoint, key });
const database = client.database('smartparking');
const userContainer = database.container('Benutzer');
const parkingContainer = database.container('Parkplatz');
const reservationContainer = database.container('Reservierungen');

// --- HILFSFUNKTIONEN ---
async function updateSpotStatus(spot) {
    const partitionKey = spot.id;
    const originalETag = spot._etag;

    try {
        const { resource: updatedSpot } = await parkingContainer.item(spot.id, partitionKey).replace(spot, {
            accessCondition: {
                type: 'IfMatch',
                condition: originalETag
            }
        });
        return updatedSpot;
    } catch (error) {
        if (error.code === 412) {
            console.error("Cosmos DB Fehler (412 Precondition Failed): Zähler wurde von anderem Nutzer aktualisiert.");
            throw new Error("Ein anderer Nutzer war schneller. Bitte versuchen Sie die Reservierung erneut.");
        }
        console.error("Cosmos DB Fehler beim Aktualisieren des Parkplatz-Status:", error.message);
        throw new Error(`Aktualisierung fehlgeschlagen: ${error.message}`);
    }
}

// --- Berechnungen ---
/**
 * Berechnet die Parkdauer und den Gesamtpreis
 * @param {string} entryTime - ISO Zeitstempel der Einfahrt
 * @param {number} hourlyRate - Preis pro Stunde für diesen Spot
 */
function calculateParkingFee(entryTime, hourlyRate) {
    const start = new Date(entryTime);
    const end = new Date();
    const durationMs = end - start;
    
    // Aufrunden auf volle Stunden
    const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
    const totalPrice = durationHours * hourlyRate;

    return {
        durationMs,
        durationHours,
        totalPrice,
        exitTime: end.toISOString()
    };
}


// --- RESERVIERUNGEN ---

async function createReservation(spotId, userId) {
    const partitionKey = spotId; // PartitionKey des Parkplatzes ist die spotId

    // 1. Hole den Parkplatz
    const spot = await getSpotById(spotId, partitionKey);
    if (!spot) return { error: `Parkplatz mit ID ${spotId} nicht gefunden.` };

    // 2. Prüfen, ob dieser Nutzer schon eine aktive Reservierung für diesen Spot hat
    const existingReservations = await reservationContainer.items
        .query({
            query: 'SELECT * FROM Reservierungen r WHERE r.spotId=@spotId AND r.userId=@userId AND r.status="active"',
            parameters: [
                { name: '@spotId', value: spotId },
                { name: '@userId', value: userId }
            ]
        }).fetchAll();

    if (existingReservations.resources.length > 0) {
        return { error: "Du hast diesen Parkplatz bereits reserviert!" };
    }

    // 3. Prüfen, ob noch freie Plätze vorhanden sind
    const availableCount = spot.availableCount ?? 0;
    if (availableCount <= 0) {
        return { error: "Parkplatz ist derzeit belegt oder nicht verfügbar." };
    }

    try {
        // 4. Hole Benutzer für Kennzeichen
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.id=@userId',
            parameters: [{ name: '@userId', value: userId }]
        };
        const { resources: users } = await userContainer.items.query(querySpec).fetchAll();
        const user = users[0];
        
        if (!user) return { error: "Benutzer nicht gefunden." };

        // 5. Erstelle neue Reservierung
        const reservationId = crypto.randomUUID();
        const reservationDurationMs = 2 * 60 * 60 * 1000; // 2 Stunden
        const startTime = new Date().toISOString();
        const endTime = new Date(Date.now() + reservationDurationMs).toISOString();

        const newReservation = {
            id: reservationId,
            spotId: spot.id,
            userId: userId,
            vehicleLicense: user.vehicleLicense,
            startTime,
            endTime,
            status: 'active',
            partitionKey: userId
        };

        await reservationContainer.items.create(newReservation, { partitionKey: newReservation.partitionKey });

        // 6. Parkplatz-Status aktualisieren
        spot.availableCount = spot.availableCount - 1;
        spot.activeReservationId = reservationId;

        await updateSpotStatus(spot); // Mit ETag-Check

        return {
            reservationId,
            message: "Reservierung erfolgreich.",
            startTime,
            endTime
        };

    } catch (error) {
        console.error("Cosmos DB Fehler bei Reservierung:", error.message);
        throw new Error("Fehler beim Erstellen der Reservierung. Bitte versuchen Sie es erneut.");
    }
}

async function getAllReservationsForUser(userId) {
    const querySpec = {
        query: 'SELECT * FROM c WHERE c.userId=@userId ORDER BY c.startTime DESC',
        parameters: [{ name: '@userId', value: userId }]
    };
    try {
        const { resources } = await reservationContainer.items.query(querySpec).fetchAll();
        return resources;
    } catch (error) {
        console.error("Cosmos DB Fehler beim Abrufen der Reservierungen:", error.message);
        throw new Error("Fehler beim Abrufen der Reservierungshistorie.");
    }
}

async function releaseReservation(reservationId, spotId, userId) {
    const reservationPartitionKey = userId;
    const spotPartitionKey = spotId;
    let updatedSpot = null;

    try {
        const { resource: reservation } = await reservationContainer.item(reservationId, reservationPartitionKey).read();
        
        if (reservation.status !== 'active') {
             throw new Error("Reservierung ist nicht aktiv und kann nicht freigegeben werden.");
        }

        reservation.status = 'cancelled';
        reservation.exitTime = new Date().toISOString();
        
        await reservationContainer.item(reservationId, reservationPartitionKey).replace(reservation);
    } catch (error) {
        console.error("Fehler beim Freigeben der Reservierung (Schritt 1):", error.message);
        throw new Error("Aktive Reservierung nicht gefunden oder Fehler beim Abschluss: " + error.message);
    }

    try {
        const spot = await getSpotById(spotId, spotPartitionKey);
        
        if (spot) {
            spot.availableCount = (spot.availableCount || 0) + 1;
            spot.activeReservationId = null;
            
            updatedSpot = await updateSpotStatus(spot);
            return updatedSpot;
        } else {
             throw new Error(`Parkplatz mit ID ${spotId} zum Freigeben nicht gefunden.`);
        }
    } catch (error) {
        console.error("KRITISCHER FEHLER beim Freigeben des Parkplatzes (Schritt 2):", error.message);
        throw new Error(`KRITISCHER FEHLER: Parkplatz-Freigabe fehlgeschlagen: ${error.message}`);
    }
}

async function getActiveReservationByPlate(plate) {
    const querySpec = {
        query: "SELECT * FROM c WHERE c.vehicleLicense = @plate AND c.status = 'active' AND IS_DEFINED(c.entryTime) = false",
        parameters: [{ name: "@plate", value: plate }]
    };
    const { resources } = await reservationContainer.items.query(querySpec).fetchAll();
    return resources[0];
}

async function getStayByPlate(plate) {
    const querySpec = {
        query: "SELECT * FROM c WHERE c.vehicleLicense = @plate AND c.status = 'active' AND IS_DEFINED(c.entryTime) = true",
        parameters: [{ name: "@plate", value: plate }]
    };
    const { resources } = await reservationContainer.items.query(querySpec).fetchAll();
    return resources[0];
}

async function updateReservation(reservation) {
    return await reservationContainer.item(reservation.id, reservation.partitionKey).replace(reservation);
}

// --- BENUTZER ---

async function getUserByEmail(email) {
    const querySpec = {
        query: 'SELECT * FROM Benutzer b WHERE b.email=@email',
        parameters: [{ name: '@email', value: email }]
    };
    const { resources } = await userContainer.items.query(querySpec).fetchAll();
    return resources[0];
}

async function registerUser(user) {
    const { resource } = await userContainer.items.create(user);
    return resource;
}

async function updateUser(user) {
    try {
        const { resource } = await userContainer.item(user.id, user.email).replace(user);
        return resource;
    } catch (error) {
        console.error("Fehler beim Datenbank-Update:", error.message);
        throw error;
    }
}

async function getUserByResetToken(token) {
    const querySpec = {
        query: 'SELECT * FROM Benutzer b WHERE b.resetPasswordToken=@token',
        parameters: [{ name: '@token', value: token }]
    };
    const { resources } = await userContainer.items.query(querySpec).fetchAll();
    return resources[0];
}

// --- PARKPLÄTZE ---

async function getAllSpots() {
    const querySpec = { query: 'SELECT * FROM Parkplatz p' };
    try {
        const { resources } = await parkingContainer.items.query(querySpec).fetchAll();
        return resources;
    } catch (error) {
        console.error("Cosmos DB Fehler beim Abrufen ALLER Parkplätze:", error.message);
        throw new Error("Fehler beim Abrufen aller Parkplätze.");
    }
}

async function getSpotById(spotId, partitionKey = spotId) {
    try {
        const { resource: item } = await parkingContainer.item(spotId, partitionKey).read();
        return item;
    } catch (error) {
        if (error.code === 404) return null;
        console.error("Cosmos DB Fehler beim Abrufen des Parkplatzes:", error.message);
        throw new Error("Fehler beim Abrufen des spezifischen Parkplatzes.");
    }
}

// --- EXPORT ---

module.exports = {
    getActiveReservationByPlate,
    getStayByPlate,
    updateReservation,
    getUserByEmail,
    registerUser,
    getAllSpots,
    getSpotById,
    updateSpotStatus,
    createReservation,
    releaseReservation,
    getAllReservationsForUser,
    updateUser,
    getUserByResetToken,
    calculateParkingFee,
    userContainer,
    parkingContainer,
    reservationContainer    
};