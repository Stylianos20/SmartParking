// routes/bills.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Deine DB-Connection (z.B. mongoose/cosmos)

// GET /api/bills – Alle Rechnungen des Users
router.get('/', async (req, res) => {
  const userId = req.user.id; // Aus JWT/Auth
  const bills = await db.query(`
    SELECT r.*, 
           TIMESTAMPDIFF(MINUTE, entryTime, exitTime) as durationMinutes,
           (TIMESTAMPDIFF(MINUTE, entryTime, exitTime) / 60.0) * 2.50 as cost // 2,50€/Stunde, anpassen!
    FROM reservations r WHERE userId = ? AND exitTime IS NOT NULL
    ORDER BY exitTime DESC
  `, [userId]); // Für Cosmos: Verwende SQL Query API
  res.json(bills);
});

// POST /api/reservations/:id/exit – Ausfahrt markieren (automatisch Rechnung)
router.post('/reservations/:id/exit', async (req, res) => {
  const { id } = req.params;
  const exitTime = new Date().toISOString();
  await db.query('UPDATE reservations SET exitTime = ? WHERE id = ? AND userId = ?', [exitTime, id, req.user.id]);
  // Trigger Rechnungsberechnung hier oder bei GET
  res.json({ message: 'Ausfahrt registriert' });
});

module.exports = router;
