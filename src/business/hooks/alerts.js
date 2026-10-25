import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const FARM_TIMEZONE = 'Africa/Nairobi';

// Calendar dates are farm-local; converting date-only values through UTC shifted them a day back.
export const utcDate = date => dayjs(date).format('YYYY-MM-DD');
export const displayDate = date => dayjs(date).tz(FARM_TIMEZONE).format('MMMM D, YYYY');

/**
 * Inserts alerts inside the caller's transaction. Email delivery is done by the
 * scheduled alert job, never inline, so a slow mail server cannot hold a DB lock.
 */
export const insertAlerts = async (client, base, alerts) => {
  if (!alerts.length) return;
  const params = [];
  const values = alerts.map(alert => {
    const start = `${utcDate(alert.start)}T00:00:00Z`;
    const notifyOn = (alert.notifyOn ?? [dayjs(alert.start).subtract(1, 'day'), alert.start]).map(utcDate);
    params.push(
      alert.name, start, alert.type, alert.severity, alert.message,
      base.farmId, base.userId ?? null, base.pigId ?? null, base.penId ?? null, notifyOn
    );
    const offset = params.length - 10;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, 'pending',
      $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::date[])`;
  });
  await client.query(
    `INSERT INTO alerts (name, alert_start_date, alert_type, severity, message, status,
       farm_id, user_id, pig_id, pen_id, notify_on)
     VALUES ${values.join(', ')}`,
    params
  );
};

/** Alerts whose notify_on dates include today in the farm timezone. */
export const todaysAlerts = async (client, farmId) => {
  const today = dayjs().tz(FARM_TIMEZONE).format('YYYY-MM-DD');
  const { rows } = await client.query(
    `SELECT * FROM alerts
     WHERE farm_id = $1 AND $2::date = ANY(notify_on) AND is_active = true AND is_deleted = false
     ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, alert_start_date`,
    [farmId, today]
  );
  return rows;
};
