// server-go-fez/controllers/ReviewController.js

const { Review, POI, User, sequelize } = require('../models');
const { uploadFromBuffer, deleteFile } = require('../Config/cloudinary');
const { awardReview, awardPoints } = require('../services/GamificationService');
const xss = require('xss');

/**
 * Calcule et met à jour la note moyenne et le nombre d'avis pour un POI.
 * @param {string} poiId - L'ID du POI à mettre à jour.
 * @param {object} transaction - La transaction Sequelize à utiliser.
 */
const updatePOIRating = async (poiId, transaction) => {
	try {
		const stats = await Review.findAll({
			where: {
				poiId: poiId,
				isDeleted: false, // Ne compte que les avis non supprimés
			},
			attributes: [
				[sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
				[sequelize.fn('COUNT', sequelize.col('id')), 'reviewCount'],
			],
			transaction: transaction, // S'assure de lire dans la transaction
		});

		let { avgRating, reviewCount } = stats[0].get();
		avgRating = avgRating ? parseFloat(avgRating).toFixed(2) : 0;
		reviewCount = reviewCount || 0;

		await POI.update(
			{
				rating: avgRating,
				reviewCount: reviewCount,
			},
			{
				where: { id: poiId },
				transaction: transaction, // S'assure d'écrire dans la transaction
			}
		);
	} catch (error) {
		console.error('Erreur lors de la mise à jour du rating du POI:', error);
		// L'erreur sera attrapée par le bloc catch externe
		throw new Error('Impossible de mettre à jour la note du POI.');
	}
};

// --- CRUD ---

/**
 * Créer un nouvel avis pour un POI
 * Requiert: req.user.userId (de l'auth), req.body.poiId, req.body.rating, req.body.comment
 * Optionnel: req.files.photos (tableau de fichiers)
 */
exports.createReview = async (req, res) => {
	const t = await sequelize.transaction();
	try {
		const { poiId, rating, comment } = req.body;
		const userId = req.user.userId; // Supposé provenir du middleware d'authentification

		if (!poiId || !rating) {
			return res.status(400).json({
				success: false,
				message: 'poiId et rating sont requis.',
			});
		}

		// Vérifier si l'utilisateur a déjà évalué ce POI
		const existingReview = await Review.findOne({
			where: { userId, poiId, isDeleted: false },
		});

		if (existingReview) {
			return res.status(409).json({
				success: false,
				message: 'Vous avez déjà laissé un avis pour ce POI.',
			});
		}

		// Gérer l'upload des photos
		let photoUrls = [];
		if (req.files && req.files.length > 0) {
			for (const file of req.files) {
				try {
					const result = await uploadFromBuffer(
						file.buffer,
						'go-fez/reviews'
					);
					photoUrls.push(result.secure_url);
				} catch (uploadError) {
					console.warn('Échec de l-upload d-une image:', uploadError.message);
				}
			}
		}

		// Créer l'avis
		const newReview = await Review.create(
			{
				userId,
				poiId,
				rating: parseFloat(rating),
				comment: comment ? xss(comment) : null,
				photos: photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
			},
			{ transaction: t }
		);

		// Mettre à jour la note moyenne du POI
		await updatePOIRating(poiId, t);

		// Valider la transaction
		await t.commit();

		// Award gamification points for review
		const isDetailed = comment && comment.length >= 100;
		awardReview(userId, newReview.id, isDetailed)
			.catch(err => console.error('Error awarding review points:', err));
		
		// Award extra points if photos were uploaded
		if (photoUrls.length > 0) {
			awardPoints(userId, 'PHOTOGRAPHY_LOVER')
				.catch(err => console.error('Error awarding photography points:', err));
		}

		res.status(201).json({
			success: true,
			message: 'Avis créé avec succès.',
			data: newReview,
		});
	} catch (error) {
		// Annuler la transaction en cas d'erreur
		await t.rollback();
		console.error('Erreur lors de la création de l-avis:', error);
		res.status(500).json({
			success: false,
			message: 'Erreur interne du serveur.',
		});
	}
};

/**
 * Obtenir tous les avis pour un POI (avec pagination)
 * Requiert: req.params.poiId
 * Optionnel: req.query.page, req.query.limit
 */
exports.getReviewsForPOI = async (req, res) => {
	try {
		const { poiId } = req.params;
		const { page = 1, limit = 10 } = req.query;
		const offset = (page - 1) * limit;

		const { count, rows } = await Review.findAndCountAll({
			where: {
				poiId: poiId,
				isDeleted: false,
			},
			include: [
				{
					model: User,
					as: 'user',
					attributes: ['firstName', 'lastName', 'profileImage'], // Ne pas inclure le mot de passe
				},
			],
			order: [['created_at', 'DESC']],
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});

		res.status(200).json({
			success: true,
			data: {
				totalItems: count,
				totalPages: Math.ceil(count / limit),
				currentPage: parseInt(page, 10),
				reviews: rows,
			},
		});
	} catch (error) {
		console.error('Erreur lors de la récupération des avis:', error);
		res.status(500).json({
			success: false,
			message: 'Erreur interne du serveur.',
		});
	}
};

/**
 * Supprimer un avis (logique)
 * Requiert: req.params.reviewId, req.user (userId, role)
 */
exports.deleteReview = async (req, res) => {
	const t = await sequelize.transaction();
	try {
		const { reviewId } = req.params;
		const { userId, role } = req.user; // De l'auth middleware

		const review = await Review.findByPk(reviewId);

		if (!review) {
			return res
				.status(404)
				.json({ success: false, message: 'Avis non trouvé.' });
		}

		// Vérifier les permissions : l'utilisateur est propriétaire ou admin
		if (review.userId !== userId && role !== 'admin') {
			return res.status(403).json({
				success: false,
				message: 'Non autorisé à supprimer cet avis.',
			});
		}

		// Suppression logique
		await review.update({ isDeleted: true }, { transaction: t });

		// Mettre à jour la note moyenne du POI
		await updatePOIRating(review.poiId, t);

		// Valider la transaction
		await t.commit();

		res.status(200).json({
			success: true,
			message: 'Avis supprimé avec succès.',
		});
	} catch (error) {
		// Annuler la transaction
		await t.rollback();
		console.error('Erreur lors de la suppression de l-avis:', error);
		res.status(500).json({
			success: false,
			message: 'Erreur interne du serveur.',
		});
	}
};