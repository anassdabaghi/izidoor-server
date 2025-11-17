const { 
    Route, 
    Circuit, 
    POI, 
    VisitedTrace, 
    RemovedTrace,
    City,
    Theme,
    POILocalization,
    Album,
    AlbumPOI,
    POIFile,
    User
} = require('../models');
const { awardPOIVisit } = require('../services/GamificationService');

const { Op, literal } = require('sequelize');
const Sequelize = require('sequelize'); 

// ====================================================================
// 1. Démarrer une nouvelle Route (POST /routes/start)
// ====================================================================
exports.startRoute = async (req, res) => {
    // 1. Extraction des données. On suppose que userId vient du token d'authentification.
    const { circuitId, longitude, latitude, pois } = req.body;
    const userId = req.user.userId; 

    if (!circuitId || !latitude || !longitude) {
        return res.status(400).json({ 
            status: 'fail', 
            message: 'circuitId, longitude, latitude sont requis.' 
        });
    }

    try {
        
        // 1.2 Vérification de l'existence du Circuit original
        const circuit = await Circuit.findOne({
              where: { id: circuitId , isDeleted: false },
              include: [
                {
                  model: City,
                  as: 'city'
                },
                {
                  model: Theme,
                  as: 'themes',
                  through: { attributes: [] },
                  where: { isDeleted: false },
                  required: false
                },
                {
                  model: POI,
                  as: 'pois',
                  through: {
                    attributes: ['order', 'estimatedTime']
                  },
                  where: { isDeleted: false },
                  required: false,
                  include: [
                    { model: POILocalization, as: 'frLocalization' },
                    { model: POILocalization, as: 'arLocalization' },
                    { model: POILocalization, as: 'enLocalization' }
                  ]
                }
              ]
            });

        if (!circuit) {
            return res.status(404).json({ 
                status: 'fail', 
                message: 'Le Circuit original est introuvable.' 
            });
        }

        let idOfPoi = (pois && pois.length > 0) ? pois[0] : null;

        // 1.3 Création du nouvel enregistrement Route
        const newRoute = await Route.create({
            userId: req.user.userId,
            circuitId,
            isCompleted: false,
            endPoint: circuit.endPoint
        });

        // 1.4 Création de la première trace (obligatoire)
        const newVisitedTrace = await VisitedTrace.create({
            routeId: newRoute.id,
            latitude,
            longitude,
            idPoi: idOfPoi 
        });
        
        return res.status(200).json({
            status: true,
            message: 'Route démarrée avec succès. Première trace enregistrée.',
            data: { 
                circuit, 
                firstTrace: newVisitedTrace,
                isRouteCompleted: false
            }
        });

    } catch (error) {
        console.error('Erreur au démarrage de la Route:', error);
        return res.status(500).json({ 
            status: false, 
            message: 'Erreur interne du serveur.' 
        });
    }
};

// ====================================================================
// 1.b Obtenir une Route par ID (GET /routes/:id)
//    - Retourne: POIs du circuit NON retirés (selon RemovedTrace du routeId)
//      et toutes les visitedTraces de la route
// ====================================================================
exports.getRouteById = async (req, res) => {
    try {
        const { id } = req.params; // routeId
        const userId = req.user.userId;

        // 0) Vérifier l'existence de la route (et l'appartenance à l'utilisateur)
        const route = await Route.findOne({ where: { id, userId } });
        if (!route) {
            return res.status(404).json({ status: false, message: 'Route introuvable.' });
        }

        // 1) Récupérer tous les POIs d'origine du circuit
        const circuitWithPois = await Circuit.findByPk(route.circuitId, {
            include: [{
                model: POI,
                as: 'pois',
                through: { attributes: ['order', 'estimatedTime'] },
                required: false,
                include: [
                    { model: POILocalization, as: 'frLocalization' },
                    { model: POILocalization, as: 'arLocalization' },
                    { model: POILocalization, as: 'enLocalization' },
                    { model: POIFile, as: 'files', where: { type: 'image' }, required: false }
                ]
            }]
        });

        if (!circuitWithPois) {
            return res.status(404).json({ status: false, message: 'Circuit non trouvé pour cette route.' });
        }

        // 2) Récupérer les POIs retirés pour cette route
        const removedTraces = await RemovedTrace.findAll({
            where: { routeId: id },
            attributes: ['poiId']
        });
        const removedPoiIds = removedTraces.map(t => t.poiId);

        // 3) Filtrer les POIs non retirés
        const poisNotRemovedRaw = (circuitWithPois.pois || []).filter(p => !removedPoiIds.includes(p.id));
        const poisNotRemoved = poisNotRemovedRaw.map((p) => {
            const po = p.toJSON ? p.toJSON() : p;
            const initialImage = Array.isArray(po.files) && po.files.length > 0
                ? (po.files.find((f) => f?.type === 'image')?.fileUrl || po.files[0]?.fileUrl)
                : null;
            return { ...po, initialImage };
        });

        // 4) Récupérer les visitedTraces de la route
        const visitedTraces = await VisitedTrace.findAll({ where: { routeId: id }, order: [[Sequelize.col('created_at'), 'ASC']] });

        return res.status(200).json({
            status: true,
            message: 'Détails de la route récupérés avec succès.',
            data: {
                route: { id: route.id, circuitId: route.circuitId, isCompleted: route.isCompleted },
                pois: poisNotRemoved,
                visitedTraces,
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération de la route:', error);
        return res.status(500).json({ status: false, message: 'Erreur interne du serveur.' });
    }
};

// Create album 

const createAlbumOnCompletion = async (route, userId) => {
    
    const newAlbum = await Album.create({
        name: `Circuit Album: ${route.circuitId} (${new Date().toLocaleDateString()})`,
        userId: userId,
    });
    
    const visitedPoisRecords = await VisitedTrace.findAll({
        where: { routeId: route.id, idPoi: { [Op.ne]: null } },
        attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('idPoi')), 'poiId']]
    });
    const visitedPoiIds = visitedPoisRecords.map(p => p.dataValues.poiId);

    if (visitedPoiIds.length === 0) {

        return { album: newAlbum, count: 0 };
    }

    const albumFiles = await POIFile.findAll({
        where: {
            poiId: { [Op.in]: visitedPoiIds },
            type: 'imageAlbum'
        },
        attributes: ['id', 'poiId'] 
    });

    const albumPOIData = albumFiles.map(file => ({
        albumId: newAlbum.id,
        poiFileId: file.id,
    }));

    let createdCount = 0;
    if (albumPOIData.length > 0) {
        const newAlbumPOIRecords = await AlbumPOI.bulkCreate(albumPOIData);
        createdCount = newAlbumPOIRecords.length;
    }

    return { album: newAlbum, createdCount };
};


// ====================================================================
// 2. Enregistrer la trace GPS et/ou la visite de POI (POST /routes/trace)
// ====================================================================
exports.addVisitedTrace = async (req, res) => {
    const { routeId, longitude, latitude, pois } = req.body;
    const userId = req.user.userId; 

    if (!routeId || !longitude || !latitude) {
        return res.status(400).json({ 
            status: 'fail', 
            message: 'routeId, longitude et latitude sont requis.' 
        });
    }

    try {
        // 1. Vérification de la Route
        const route = await Route.findOne({
            where: { id: routeId, userId: userId, isCompleted: false }
        });
        
        if (!route) {
            return res.status(404).json({ 
                status: 'fail', 
                message: 'Route introuvable ou déjà complétée/annulée.' 
            });
        }

        let idOfPoi = (pois && pois.length > 0) ? pois[0] : null;

        // 2. Création de l'enregistrement VisitedTrace
        const newTrace = await VisitedTrace.create({
            routeId,
            longitude,
            latitude,
            idPoi: idOfPoi
        });
        
        // Award gamification points for POI visit
        if (idOfPoi) {
            awardPOIVisit(userId, idOfPoi, { routeId, location: { longitude, latitude } })
                .catch(err => console.error('Error awarding POI visit:', err));
        }
        
        // =========================================================
        // 3. LOGIQUE DE VÉRIFICATION D'AUTO-COMPLÉTION (FINAL)
        // =========================================================
        let isRouteCompleted = false;

        // N'exécuter la logique de vérification complète que si un POI a été signalé
        if (idOfPoi) {
            
            // A. Obtenir tous les POIs originaux du Circuit
            const circuitWithPois = await Circuit.findByPk(route.circuitId, {
                include: [{
                    model: POI,
                    as: 'pois', // Assurez-vous que cette association est définie dans Circuit.js
                    attributes: ['id'],
                    through: { attributes: [] }
                }]
            });
            
            if (!circuitWithPois) {
                return res.status(404).json({ status: 'fail', message: 'Circuit non trouvé.' });
            }

            const allOriginalPoiIds = circuitWithPois.pois.map(p => p.id);
            
            // B. Identifier les POIs retirés
            const removedTraces = await RemovedTrace.findAll({
                where: { userId: userId, circuitId: route.circuitId },
                attributes: ['poiId']
            });
            const removedPoiIds = removedTraces.map(t => t.poiId);

            // C. Déterminer les POIs REQUIs (Originals - Removed)
            const requiredPoiIds = allOriginalPoiIds.filter(id => 
                !removedPoiIds.includes(id)
            );

            // D. Déterminer les POIs VISITÉS (Uniques)
            const visitedPoisRecords = await VisitedTrace.findAll({
                where: { routeId: route.id, idPoi: { [Op.ne]: null } },
                // Utiliser DISTINCT pour ne compter qu'une seule visite par POI
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('idPoi')), 'poiId']] 
            });
            // Convertir le résultat en un tableau simple d'IDs
            const visitedPoiIds = visitedPoisRecords.map(p => p.dataValues.poiId);
            
            // E. Comparaison Finale: Le nombre de POIs visités correspond-il aux POIs requis?
            if (requiredPoiIds.length > 0 && requiredPoiIds.length === visitedPoiIds.length) {
                // Vérifier qu'AUCUN POI requis n'a été manqué
                const allRequiredVisited = requiredPoiIds.every(id => visitedPoiIds.includes(id));
                
                if (allRequiredVisited) {
                    isRouteCompleted = true;
                }
            }
        }
        
        // 4. Mise à jour de la Route si complétée

        let createdAlbum = null;
        if (isRouteCompleted) {
            await Route.update(
                { isCompleted: true },
                { where: { id: route.id } } 
            );

            try {
                const albumResult = await createAlbumOnCompletion(route, userId);
                createdAlbum = albumResult.album;
                console.log(`Album créé : ${createdAlbum.id}, avec ${albumResult.createdCount} fichiers attachés.`);
            } catch (albumError) {
                console.error("Erreur lors de la création de l'Album:", albumError);
            }
        }
        

        // 5. Préparation de la réponse (Récupérer toutes les traces pour le contexte du front-end)
        const visitedTraces = await VisitedTrace.findAll({ where: { routeId: route.id } });

        return res.status(200).json({
            status: true,
            message: isRouteCompleted ? 'Route complétée et Album créé.' : 'Trace enregistrée avec succès.',
            data: {
                newTrace: newTrace, 
                visitedTraces: visitedTraces,
                isRouteCompleted: isRouteCompleted,
                albumId: createdAlbum ? createdAlbum.id : null
            }
        });

    } catch (error) {
        console.error('Erreur lors de l\'ajout de la trace:', error);
        return res.status(500).json({ status: false, message: 'Erreur interne du serveur.' });
    }
};


// ====================================================================
// 5. Retirer un POI de la Route (POST /routes/remove-poi)
// ====================================================================
exports.removePOIFromRoute = async (req, res) => {

    const { routeId, poiId } = req.body;
    const userId = req.user.userId;

    if (!routeId || !poiId) {
        return res.status(400).json({
            status: 'fail',
            message: 'routeId et poiId sont requis.'
        });
    }

    try {

        const route = await Route.findOne({
            where: { id: routeId, userId: userId, isCompleted: false },
            attributes: ['id', 'circuitId']
        });

        if (!route) {
            return res.status(404).json({
                status: 'fail',
                message: 'Route introuvable, complétée ou n\'appartient pas à cet utilisateur.'
            });
        }
        
        const circuitId = route.circuitId;
        const isPoiInCircuit = await Circuit.findOne({
            where: { id: circuitId },
            include: [{
                model: POI,
                as: 'pois',
                where: { id: poiId },
                required: true 
            }]
        });

        if (!isPoiInCircuit) {
             return res.status(404).json({
                status: 'fail',
                message: 'Ce POI n\'est pas initialement dans ce Circuit.'
            });
        }
        
        const existingRemoval = await RemovedTrace.findOne({
            where: {
                userId: userId,
                routeId: routeId,
                poiId: poiId
            }
        });

        if (existingRemoval) {
            return res.status(200).json({
                status: true,
                message: 'Le POI est déjà marqué comme retiré pour cette Route.',
                data: { removedTrace: existingRemoval }
            });
        }

        const newRemovedTrace = await RemovedTrace.create({
            userId: userId,
            routeId: routeId, 
            poiId: poiId
        });
        
        let isRouteCompleted = false;

        const circuitWithPois = await Circuit.findByPk(circuitId, {
            include: [{
                model: POI,
                as: 'pois',
                attributes: ['id'],
                through: { attributes: [] }
            }]
        });

        const allOriginalPoiIds = circuitWithPois.pois.map(p => p.id);

        const removedTraces = await RemovedTrace.findAll({
            where: { routeId: routeId }, 
            attributes: ['poiId']
        });
        const removedPoiIds = removedTraces.map(t => t.poiId);

        const requiredPoiIds = allOriginalPoiIds.filter(id =>
            !removedPoiIds.includes(id)
        );

        const visitedPoisRecords = await VisitedTrace.findAll({
            where: { routeId: routeId, idPoi: { [Op.ne]: null } },
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('idPoi')), 'poiId']]
        });
        const visitedPoiIds = visitedPoisRecords.map(p => p.dataValues.poiId);

        if (requiredPoiIds.length > 0 && requiredPoiIds.length <= visitedPoiIds.length) { 
            const allRequiredVisited = requiredPoiIds.every(id => visitedPoiIds.includes(id));

            if (allRequiredVisited) {
                isRouteCompleted = true;
            }
        }

        let createdAlbum = null;
        if (isRouteCompleted) {
            await Route.update(
                { isCompleted: true },
                { where: { id: route.id } }
            );

            try {
                const albumResult = await createAlbumOnCompletion(route, userId);
                createdAlbum = albumResult.album;
            } catch (albumError) {
                console.error("Erreur lors de la création de l'Album après suppression:", albumError);
            }
        }

        return res.status(200).json({
            status: true,
            message: isRouteCompleted ? 'POI retiré. Route complétée et Album créé.' : 'POI retiré de la Route avec succès. Vérification d\'auto-complétion effectuée.',
            data: {
                removedTrace: newRemovedTrace,
                isRouteCompleted: isRouteCompleted,
                albumId: createdAlbum ? createdAlbum.id : null
            }
        });

    } catch (error) {
        console.error('Erreur lors du retrait du POI de la Route:', error);
        return res.status(500).json({
            status: false,
            message: 'Erreur interne du serveur.'
        });
    }
};



exports.getAllRoutes = async (req, res) => {
      try {
            const search = req.query.search || '';
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            // Condition de recherche dans le JSON si search est fourni
            const whereCircuit = search
      ? Sequelize.literal(`
            JSON_UNQUOTE(JSON_EXTRACT(circuit.fr, '$.name')) LIKE '%${search}%'
            OR JSON_UNQUOTE(JSON_EXTRACT(circuit.ar, '$.name')) LIKE '%${search}%'
            OR JSON_UNQUOTE(JSON_EXTRACT(circuit.en, '$.name')) LIKE '%${search}%'
      `)
                  : {};

            const routesResult = await Route.findAndCountAll({
      include: [
            {
                  model: Circuit,
                  as: 'circuit',
                  required: !!search,
                  where: whereCircuit,
                  include: [
                        { model: City, as: 'city', required: false }
                  ]
            }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
});


            return res.status(200).json({
                  status: true,
                  message: "Liste des routes récupérée avec succès.",
                  pagination: {
                        total: routesResult.count,
                        currentPage: page,
                        totalPages: Math.ceil(routesResult.count / limit)
                  },
                  data: routesResult.rows
            });

      } catch (error) {
            console.error("Erreur lors de la récupération des Routes:", error);
            return res.status(500).json({
                  status: false,
                  message: "Erreur serveur lors de la récupération des routes.",
                  error: error.message
            });
      }
};


exports.getAllRoutes = async (req, res) => {
      try {
            const search = req.query.search || '';
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            // Condition de recherche dans le JSON si search est fourni
            const whereCircuit = search
      ? Sequelize.literal(`
            JSON_UNQUOTE(JSON_EXTRACT(circuit.fr, '$.name')) LIKE '%${search}%'
            OR JSON_UNQUOTE(JSON_EXTRACT(circuit.ar, '$.name')) LIKE '%${search}%'
            OR JSON_UNQUOTE(JSON_EXTRACT(circuit.en, '$.name')) LIKE '%${search}%'
      `)
                  : {};

            const routesResult = await Route.findAndCountAll({
      include: [
            {
                  model: Circuit,
                  as: 'circuit',
                  required: !!search,
                  where: whereCircuit,
                  include: [
                        { model: City, as: 'city', required: false }
                  ]
            }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
});


            return res.status(200).json({
                  status: true,
                  message: "Liste des routes récupérée avec succès.",
                  pagination: {
                        total: routesResult.count,
                        currentPage: page,
                        totalPages: Math.ceil(routesResult.count / limit)
                  },
                  data: routesResult.rows
            });

      } catch (error) {
            console.error("Erreur lors de la récupération des Routes:", error);
            return res.status(500).json({
                  status: false,
                  message: "Erreur serveur lors de la récupération des routes.",
                  error: error.message
            });
      }
};


