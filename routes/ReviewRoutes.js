// server-go-fez/routes/ReviewRoutes.js

const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/ReviewController');
const multer = require('multer');

// Importer le middleware d'authentification
const { authenticateToken } = require('../middleware/authEnhanced');

// Configuration multer pour l'upload des photos en mémoire
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 5 * 1024 * 1024, // Limite à 5MB par fichier
	},
	fileFilter: (req, file, cb) => {
		if (file.mimetype.startsWith('image/')) {
			cb(null, true);
		} else {
			cb(new Error('Seules les images sont autorisées!'), false);
		}
	},
});

/**
 * @route   POST /api/reviews
 * @desc    Créer un nouvel avis
 * @access  Privé (Utilisateur connecté)
 * @body    { poiId, rating, comment }
 * @files   photos (optionnel, max 5)
 */
router.post(
	'/',
	authenticateToken, // Protège la route
	upload.array('photos', 5), // Gère l'upload de max 5 photos
	reviewController.createReview
);

/**
 * @route   GET /api/reviews/poi/:poiId
 * @desc    Récupérer les avis pour un POI (avec pagination)
 * @access  Public
 * @params  poiId
 * @query   page, limit
 */
router.get('/poi/:poiId', reviewController.getReviewsForPOI);

/**
 * @route   DELETE /api/reviews/:reviewId
 * @desc    Supprimer un avis (par le propriétaire ou un admin)
 * @access  Privé (Propriétaire ou Admin)
 * @params  reviewId
 */
router.delete(
	'/:reviewId',
	authenticateToken, // Protège la route
	reviewController.deleteReview
);

module.exports = router;