const express = require('express');
const router = express.Router();
const routeController = require('../controllers/routeController');
const { authenticateToken }= require('../middleware/authEnhanced')

// POST /api/routes/start
router.post('/start', authenticateToken, routeController.startRoute);

// GET /api/routes/:id → détail route (pois non retirés + traces)
router.get('/:id', authenticateToken, routeController.getRouteById);

// 2. Enregistrer une trace GPS et/ou une visite de POI
// POST /api/routes/trace
router.post('/trace', authenticateToken, routeController.addVisitedTrace);


// 5. Retirer un POI du circuit (Personnalisation)
// POST /api/routes/remove-poi
router.post('/remove-poi', authenticateToken, routeController.removePOIFromRoute);


router.get('/', authenticateToken, routeController.getAllRoutes);

module.exports = router;