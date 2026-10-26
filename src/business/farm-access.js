import { pool } from '../config/database.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const trialDays = () => {
  const parsed = Number.parseInt(process.env.TRIAL_PERIOD ?? '30', 10);
  return Number.isNaN(parsed) ? 30 : Math.max(parsed, 1);
};

/**
 * The caller's access to one farm: their role and permissions, plus the plan that
 * applies. Team members use the farm owner's subscription, so a worker on a paid
 * farm gets the paid features. Returns null when the user has no access.
 */
export const loadFarmAccess = async (userId, farmId, client = pool) => {
  const { rows } = await client.query(
    `SELECT f.id, f.name, f.created_by, f.created_at AS farm_created_at,
            owner.subscription_end AS owner_subscription_end,
            fr.key AS role_key, fr.name AS role_name, fr.permissions, fr.is_owner_role
     FROM farms f
     LEFT JOIN users owner ON owner.id = f.created_by
     LEFT JOIN farm_members m ON m.farm_id = f.id AND m.user_id = $2 AND m.status = 'active'
     LEFT JOIN farm_roles fr ON fr.id = m.farm_role_id AND fr.is_active = 1 AND fr.is_deleted = 0
     WHERE f.id = $1 AND f.is_deleted = 0 AND (f.created_by = $2 OR fr.id IS NOT NULL)`,
    [farmId, userId]
  );
  if (!rows.length) return null;
  const farm = rows[0];
  const isOwner = farm.created_by === userId;
  const now = Date.now();
  const trialEndsAt = new Date(new Date(farm.farm_created_at).getTime() + trialDays() * DAY_IN_MS);
  const subscriptionEnd = farm.owner_subscription_end ? new Date(farm.owner_subscription_end) : null;

  return {
    farmId: farm.id,
    farmName: farm.name,
    ownerId: farm.created_by,
    isOwner,
    roleKey: isOwner ? 'farm_admin' : farm.role_key,
    roleName: isOwner ? 'Farm admin' : farm.role_name,
    // The owner always has full access, whatever their role row says.
    permissions: isOwner || farm.is_owner_role ? ['*'] : farm.permissions ?? [],
    accessControl: {
      trialPeriodDays: trialDays(),
      trialEndsAt: trialEndsAt.toISOString(),
      isTrialActive: now <= trialEndsAt.getTime(),
      hasActiveSubscription: Boolean(subscriptionEnd && subscriptionEnd.getTime() >= now),
      subscriptionEndsAt: subscriptionEnd ? subscriptionEnd.toISOString() : null,
    },
  };
};

/** Farms the user can open: their own plus those they are an active member of. */
export const listUserFarms = async userId => {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.location, (f.created_by = $1) AS is_owner,
            CASE WHEN f.created_by = $1 THEN 'Farm admin' ELSE fr.name END AS role_name
     FROM farms f
     LEFT JOIN farm_members m ON m.farm_id = f.id AND m.user_id = $1 AND m.status = 'active'
     LEFT JOIN farm_roles fr ON fr.id = m.farm_role_id
     WHERE f.is_deleted = 0 AND (f.created_by = $1 OR m.id IS NOT NULL)
     ORDER BY f.created_at`,
    [userId]
  );
  return rows;
};
