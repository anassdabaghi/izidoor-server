const { DataTypes } = require('sequelize');
const db = require('../Config/db');
const sequelize = db.getSequelize();

const Route = sequelize.define('Route', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  circuitId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
        model: 'circuits', // Nom de la table du Circuit
        key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
},
  userId: {
            type: DataTypes.INTEGER,
        // Si DataTypes.INTEGER seul ne suffit pas, essayez DataTypes.INTEGER.UNSIGNED
        allowNull: false,
        references: {
            model: 'users', // Nom de la table de l'Utilisateur
            key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
             },
 endPoint: {
            type: DataTypes.JSON, 
            allowNull: true,
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
   },
  isCompleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            allowNull: false,
        },
  isDeleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  createdAt: {
    type: DataTypes.DATE,
    field: 'created_at',
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'updated_at',
    defaultValue: DataTypes.NOW,
  },
}, 
{
  tableName: 'routes',
  timestamps: true,
  updatedAt: 'updated_at',
  createdAt: 'created_at',
});

module.exports = { Route };
