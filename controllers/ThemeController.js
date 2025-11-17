const { Theme, Circuit } = require('../models');
const xss = require('xss');
const { uploadImage, uploadThemeFiles, deleteFile } = require("../Config/cloudinary");
const { Op } = require('sequelize');


const sanitizeThemeLocalizations = (localizations) => {
    const data = {};
    if (localizations.ar) {
        data.ar = {
            name: xss(localizations.ar.name || ''),
            desc: xss(localizations.ar.desc || '')
        };
    }
    if (localizations.fr) {
        data.fr = {
            name: xss(localizations.fr.name || ''),
            desc: xss(localizations.fr.desc || '')
        };
    }
    if (localizations.en) {
        data.en = {
            name: xss(localizations.en.name || ''),
            desc: xss(localizations.en.desc || '')
        };
    }
    return data;
};


exports.createTheme = async (req, res) => {
    const iconFile = req.files?.icon ? req.files.icon[0] : null;
    const imageFile = req.files?.image ? req.files.image[0] : null;
    
    try {
        const { data } = req.body;
        
        if (!data) {
            return res.status(400).json({ status: 'fail', message: 'Le champ de données (data) est manquant.' });
        }
        
        const themeData = JSON.parse(data);
        
        const { localizations, color, isActive } = themeData;

        if (!localizations || !localizations.ar || !localizations.fr || !localizations.en || !color) {
            return res.status(400).json({ status: 'fail', message: 'Champs de données requis (localizations, color) manquants.' });
        }

        if (!imageFile || !iconFile) {
            if (iconFile) {
                const iconPublicId = iconFile.filename || iconFile.public_id;
                if (iconPublicId) await deleteFile(iconPublicId);
            }
            if (imageFile) {
                const imagePublicId = imageFile.filename || imageFile.public_id;
                if (imagePublicId) await deleteFile(imagePublicId);
            }
            return res.status(400).json({ status: 'fail', message: "L'image et l'icône du thème sont requises." });
        }
        
        const sanitizedLocalizations = sanitizeThemeLocalizations(localizations);

        // CloudinaryStorage retourne les fichiers avec une structure spéciale
        // path = URL Cloudinary, filename = public_id
        const imageUrl = imageFile.path || imageFile.url || imageFile.location;
        const iconUrl = iconFile.path || iconFile.url || iconFile.location;
        const imagePublicId = imageFile.filename || imageFile.public_id;
        const iconPublicId = iconFile.filename || iconFile.public_id;

        const sanitizedData = {
            ...sanitizedLocalizations, 
            color: xss(color),
            isActive: isActive === 'true' || isActive === true,
            isDeleted: false,

            image: imageUrl, 
            imagePublicId: imagePublicId, 
            icon: iconUrl,
            iconPublicId: iconPublicId
        };

        console.log('🏗️ Création du thème avec les données:', sanitizedData);
        
        const theme = await Theme.create(sanitizedData);
        
        return res.status(201).json({ status: 'success', data: theme });
        
    } catch (error) {
        console.error('❌ Erreur création thème :', error);
        
        // Supprimer les fichiers uploadés en cas d'erreur
        if (iconFile) {
            const iconPublicId = iconFile.filename || iconFile.public_id;
            if (iconPublicId) await deleteFile(iconPublicId).catch(console.error);
        }
        if (imageFile) {
            const imagePublicId = imageFile.filename || imageFile.public_id;
            if (imagePublicId) await deleteFile(imagePublicId).catch(console.error);
        }
        
        if (error instanceof SyntaxError && error.message.includes('Unexpected token')) {
            return res.status(400).json({ status: 'fail', message: 'Le format des données JSON (data) est invalide.' });
        }
        
        return res.status(500).json({ status: 'error', message: 'Erreur serveur', error: error.message });
    }
};

exports.getAllThemes = async (req, res) => {
  try {
    const { page, limit, search, isActive, sortBy } = req.query;

    // Smart endpoint: if no pagination params, return simple array (backward compatibility)
    if (!page && !limit) {
      const themes = await Theme.findAll({
        where: { isDeleted: false },
        include: [
          {
            model: Circuit,
            as: 'circuitsFromThemes',
            through: { attributes: [] },
            attributes: ['id']
          }
        ],
        order: [['id', 'ASC']]
      });

      const data = themes.map(theme => ({
        ...theme.toJSON(),
        circuitsCount: theme.circuitsFromThemes?.length || 0
      }));

      return res.status(200).json({ status: 'success', data });
    }

    // Otherwise, return paginated response
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    const whereClause = { isDeleted: false };
    const searchConditions = [];

    // Search in JSON localization fields
    if (search) {
      const searchPattern = `%${search}%`;
      searchConditions.push(
        Theme.sequelize.where(
          Theme.sequelize.cast(Theme.sequelize.col('Theme.fr'), 'CHAR'),
          { [Op.like]: searchPattern }
        ),
        Theme.sequelize.where(
          Theme.sequelize.cast(Theme.sequelize.col('Theme.ar'), 'CHAR'),
          { [Op.like]: searchPattern }
        ),
        Theme.sequelize.where(
          Theme.sequelize.cast(Theme.sequelize.col('Theme.en'), 'CHAR'),
          { [Op.like]: searchPattern }
        )
      );
    }

    // Filter by active status
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    // Combine where clause with search
    const finalWhere = searchConditions.length > 0
      ? { ...whereClause, [Op.or]: searchConditions }
      : whereClause;

    // Sorting
    let orderClause = [['id', 'ASC']];
    if (sortBy === 'newest') orderClause = [['created_at', 'DESC']];
    else if (sortBy === 'oldest') orderClause = [['created_at', 'ASC']];
    else if (sortBy === 'name') orderClause = [['fr', 'ASC']];

    const { count, rows } = await Theme.findAndCountAll({
      where: finalWhere,
      limit: limitNum,
      offset: offset,
      include: [
        {
          model: Circuit,
          as: 'circuitsFromThemes',
          through: { attributes: [] },
          attributes: ['id']
        }
      ],
      order: orderClause,
      distinct: true
    });

    const themesWithCount = rows.map(theme => ({
      ...theme.toJSON(),
      circuitsCount: theme.circuitsFromThemes?.length || 0
    }));

    const totalPages = Math.ceil(count / limitNum);

    res.status(200).json({
      status: 'success',
      data: themesWithCount,
      pagination: {
        totalCount: count,
        currentPage: pageNum,
        totalPages: totalPages,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error('❌ Erreur getAllThemes:', error);
    res.status(500).json({ status: 'error', message: 'Erreur serveur', error: error.message });
  }
};

exports.getThemeById = async (req, res) => {
  try {
    const theme = await Theme.findOne({
      where: { id: req.params.id, isDeleted: false },
      include: [
        {
          model: Circuit,
          as: 'circuitsFromThemes',
          through: { attributes: [] },
          attributes: ['id']
        }
      ]
    });

    if (!theme) {
      return res.status(404).json({ status: 'fail', message: 'Thème introuvable' });
    }

    res.status(200).json({ status: 'success', data: theme });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur serveur', error: error.message });
  }
};

exports.updateTheme = async (req, res) => {
    const { id } = req.params;
    const iconFile = req.files?.icon ? req.files.icon[0] : null;
    const imageFile = req.files?.image ? req.files.image[0] : null;

    let uploadedIconPublicId = null; 
    let uploadedImagePublicId = null;

    try {
        const theme = await Theme.findByPk(id);
        if (!theme || theme.isDeleted) {
            return res.status(404).json({ status: 'fail', message: 'Thème introuvable' });
        }
        
        let themeData = req.body;

        if (req.body.data) {
            try {
                themeData = JSON.parse(req.body.data);
            } catch (e) {
                if (iconFile) await deleteFile(iconFile.filename);
                if (imageFile) await deleteFile(imageFile.filename);
                return res.status(400).json({ status: 'fail', message: 'Le format des données JSON (data) est invalide.' });
            }
        }

        const sanitizedData = {};
        
        if (themeData.localizations) {
            Object.assign(sanitizedData, sanitizeThemeLocalizations(themeData.localizations));
        }
        
        if (themeData.color) sanitizedData.color = xss(themeData.color);
        if (themeData.isActive !== undefined)
            sanitizedData.isActive = themeData.isActive === 'true' || themeData.isActive === true;

        
        if (iconFile) {
            if (theme.iconPublicId) { 
                console.log(`🗑️ Suppression icône Cloudinary ancienne: ${theme.iconPublicId}`);
                await deleteFile(theme.iconPublicId);
            }
            sanitizedData.icon = iconFile.path || iconFile.url || iconFile.location;
            sanitizedData.iconPublicId = iconFile.filename || iconFile.public_id;
            uploadedIconPublicId = iconFile.filename || iconFile.public_id;
        }

        if (imageFile) {
            if (theme.imagePublicId) { 
                console.log(`🗑️ Suppression image Cloudinary ancienne: ${theme.imagePublicId}`);
                await deleteFile(theme.imagePublicId);
            }
            sanitizedData.image = imageFile.path || imageFile.url || imageFile.location;
            sanitizedData.imagePublicId = imageFile.filename || imageFile.public_id;
            uploadedImagePublicId = imageFile.filename || imageFile.public_id;
        } 
        
        await theme.update(sanitizedData);
        const updatedTheme = await Theme.findByPk(id); 
        
        return res.status(200).json({ status: 'success', data: updatedTheme });
        
    } catch (error) {
        console.error('❌ Erreur mise à jour thème :', error);
        
        if (uploadedIconPublicId) await deleteFile(uploadedIconPublicId).catch(console.error);
        if (uploadedImagePublicId) await deleteFile(uploadedImagePublicId).catch(console.error);
        
        return res.status(500).json({ status: 'error', message: 'Erreur serveur', error: error.message });
    }
};


exports.deleteTheme = async (req, res) => {
    try {
        const theme = await Theme.findByPk(req.params.id);
        if (!theme || theme.isDeleted) {
            return res.status(404).json({ status: 'fail', message: 'Thème introuvable' });
        }
        
        if (theme.imagePublicId) { 
            console.log(`🗑️ Suppression image Cloudinary: ${theme.imagePublicId}`);
            await deleteFile(theme.imagePublicId);
        } 
        if (theme.iconPublicId) { 
            console.log(`🗑️ Suppression icône Cloudinary: ${theme.iconPublicId}`);
            await deleteFile(theme.iconPublicId);
        }
        
        await theme.update({ isDeleted: true });
        return res.status(200).json({ status: 'success', message: 'Thème supprimé avec succès' });
    } catch (error) {
        console.error('❌ Erreur suppression thème :', error);
        return res.status(500).json({ status: 'error', message: 'Erreur serveur', error: error.message });
    }
};
