/*
 * Development-only sample data: simulates 12 months of a working piggery for an existing
 * farmer account, plus demo farmers and M-Pesa payments for the admin dashboard.
 *
 *   npm run seed:sample -- --email=farmer@example.com [--demo-farmers=30]
 *
 * Everything created is tagged (pig tags "S-", notes "seed:sample", demo domain) so re-running
 * replaces the previous sample without touching the farmer's own records.
 */
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { pool } from '../config/database.js';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed sample data in production.');
  process.exit(1);
}

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const EMAIL = args.email;
const DEMO_FARMERS = Number(args['demo-farmers'] ?? 30);
const TAG = 'seed:sample';
const DEMO_DOMAIN = 'demo.pigmaster.test';
const DAY = 86_400_000;

if (!EMAIL) {
  console.error('Usage: npm run seed:sample -- --email=farmer@example.com [--demo-farmers=30]');
  process.exit(1);
}

// Deterministic pseudo-random numbers so every run produces the same farm history.
let state = 20261025;
const rand = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = list => list[Math.floor(rand() * list.length)];

const today = new Date(new Date().toISOString().slice(0, 10));
const start = new Date(today.getTime() - 365 * DAY);
const addDays = (date, days) => new Date(date.getTime() + days * DAY);
const iso = date => date.toISOString().slice(0, 10);
const ageDays = (birth, at) => Math.floor((at - birth) / DAY);

const RATIONS = {
  piglet: ['Creep pellets', 0.3], weaner: ['Sow & weaner meal', 1.0], grower: ['Pig grower meal', 1.8],
  finisher: ['Pig finisher meal', 2.5], dry_sow: ['Sow & weaner meal', 2.5], pregnant_sow: ['Sow & weaner meal', 2.5],
  lactating_sow: ['Sow & weaner meal', 5.0], boar: ['Sow & weaner meal', 2.5],
};
const BAG_PRICE = { 'Creep pellets': 5200, 'Sow & weaner meal': 3400, 'Pig grower meal': 3300, 'Pig finisher meal': 3200 };

/** Inserts many rows with one multi-VALUES statement per chunk. */
const bulkInsert = async (client, table, columns, rows, returning = '') => {
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params = [];
    const values = chunk.map(row => `(${row.map(value => { params.push(value); return `$${params.length}`; }).join(', ')})`);
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')} ${returning ? `RETURNING ${returning}` : ''}`,
      params
    );
    out.push(...result.rows);
  }
  return out;
};

/** Simulates breeding, growth, sales and deaths day by day from 12 months ago until today. */
const simulateHerd = () => {
  const pigs = [];
  const breeding = [];
  const piglets = [];
  let pigletSeq = 0;
  const breeds = ['Large White', 'Landrace', 'Duroc', 'Large White x Landrace'];

  const boars = [1, 2].map(n => ({
    tag: `S-BOAR-${n}`, name: pick(['Tank', 'Duke', 'Bruno', 'Max']), gender: 'male', breed: n === 1 ? 'Duroc' : 'Large White',
    birth: addDays(start, -between(420, 600)), acquired: start, kind: 'boar', weight: between(220, 260),
  }));
  const sows = Array.from({ length: 10 }, (_, i) => ({
    tag: `S-SOW-${String(i + 1).padStart(2, '0')}`, name: pick(['Daisy', 'Rosie', 'Peppa', 'Bella', 'Molly', 'Wanjiru', 'Akinyi', 'Nyokabi']),
    gender: 'female', breed: pick(['Large White', 'Landrace']), birth: addDays(start, -between(380, 700)),
    acquired: start, kind: 'sow', weight: between(180, 230),
  }));
  pigs.push(...boars, ...sows);

  for (const sow of sows) {
    let mating = addDays(start, between(0, 70));
    while (mating < today) {
      const boar = pick(boars);
      const farrow = addDays(mating, 114);
      const record = { sow: sow.tag, boar: boar.tag, mating, expected: farrow, actual: null, litter: null };
      breeding.push(record);
      if (farrow > today) { sow.pregnantFrom = mating; sow.expected = farrow; break; }
      record.actual = farrow;
      record.litter = between(8, 13);
      const deaths = rand() < 0.6 ? between(0, 2) : between(1, 3);
      for (let n = 0; n < record.litter; n += 1) {
        pigletSeq += 1;
        const died = n < deaths;
        const tag = `S-${String(pigletSeq).padStart(4, '0')}`;
        const gender = rand() < 0.5 ? 'male' : 'female';
        const piglet = {
          record, number: tag, gender, birthWeight: (1.1 + rand() * 0.6).toFixed(2),
          status: died ? 'dead' : addDays(farrow, 56) <= today ? 'weaned' : 'alive',
          weaningWeight: !died && addDays(farrow, 56) <= today ? (14 + rand() * 6).toFixed(2) : null,
        };
        piglets.push(piglet);
        if (died) continue;
        const pig = {
          tag, gender, birth: farrow, acquired: farrow, kind: 'grower', mother: sow.tag, father: boar.tag,
          breed: sow.breed === boar.breed ? sow.breed : pick(breeds), name: null,
        };
        // About 3% die after weaning; the rest are sold at 165-200 days (85-105 kg liveweight).
        if (rand() < 0.03) {
          const deathDate = addDays(farrow, between(60, 150));
          if (deathDate <= today) pig.removed = { date: deathDate, reason: pick(['death - disease', 'death - accident']) };
        }
        const saleDate = addDays(farrow, between(165, 200));
        if (!pig.removed && saleDate <= today) {
          const weight = between(85, 105);
          pig.removed = { date: saleDate, reason: 'sale', weight, amount: weight * between(300, 330), buyer: pick(["Farmer's Choice", 'Local butcher', 'Neighbour farm', 'Market trader']) };
        }
        pig.weight = pig.removed ? 0 : Math.min(110, Math.max(2, Math.round(ageDays(farrow, today) * 0.55)));
        pigs.push(pig);
      }
      mating = addDays(farrow, 56 + between(5, 10));
    }
  }
  return { pigs, breeding, piglets };
};

/** Feeding stage of a pig on a given day (mirrors the API's feeding plan). */
const stageOn = (pig, day, lactatingSows, pregnantSows) => {
  if (pig.kind === 'boar') return 'boar';
  if (pig.kind === 'sow') {
    if (lactatingSows.has(pig.tag)) return 'lactating_sow';
    if (pregnantSows.has(pig.tag)) return 'pregnant_sow';
    return 'dry_sow';
  }
  const age = ageDays(pig.birth, day);
  if (age < 56) return 'piglet';
  if (age < 85) return 'weaner';
  if (age < 121) return 'grower';
  return 'finisher';
};

const cleanup = async (client, farmId) => {
  await client.query(`DELETE FROM feeding_records WHERE farm_id = $1 AND notes = $2`, [farmId, TAG]);
  await client.query(`DELETE FROM feed_inventory WHERE farm_id = $1 AND notes = $2`, [farmId, TAG]);
  await client.query(`DELETE FROM earnings_records WHERE farm_id = $1 AND notes LIKE $2`, [farmId, `${TAG}%`]);
  await client.query(`DELETE FROM removal_records WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM health_records WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM piglet_records WHERE farm_id = $1 AND notes = $2`, [farmId, TAG]);
  await client.query(`DELETE FROM pig_birth_history WHERE farm_id = $1 AND sow_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM breeding_records WHERE farm_id = $1 AND sow_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM alerts WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM pen_pig_history WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  // Children before parents (self-referencing parent ids).
  await client.query(`UPDATE pigs SET parent_male_id = NULL, parent_female_id = NULL WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM pigs WHERE farm_id = $1 AND pig_id LIKE 'S-%'`, [farmId]);
  await client.query(`DELETE FROM feeding_records WHERE farm_id = $1 AND pen_id IN (SELECT id FROM pens WHERE row_id IN (SELECT id FROM rows WHERE farm_id = $1 AND description = $2))`, [farmId, TAG]);
  await client.query(`DELETE FROM pens WHERE row_id IN (SELECT id FROM rows WHERE farm_id = $1 AND description = $2)`, [farmId, TAG]);
  await client.query(`DELETE FROM rows WHERE farm_id = $1 AND description = $2`, [farmId, TAG]);
};

const seedFarm = async (client, user, farmId) => {
  const { pigs, breeding, piglets } = simulateHerd();
  const live = pigs.filter(pig => !pig.removed);

  // Houses sized for today's herd, six pigs per pen.
  const lactating = new Set(breeding.filter(b => b.actual && addDays(b.actual, 56) > today).map(b => b.sow));
  const pregnant = new Set(breeding.filter(b => !b.actual).map(b => b.sow));
  const groups = {};
  for (const pig of live) {
    const stage = stageOn(pig, today, lactating, pregnant);
    const house = { boar: 'Boar Pens', lactating_sow: 'Farrowing House', pregnant_sow: 'Sow House', dry_sow: 'Sow House',
      piglet: 'Farrowing House', weaner: 'Weaner House', grower: 'Grower House', finisher: 'Finisher House' }[stage];
    (groups[house] ??= []).push(pig);
  }
  const penOf = {};
  const housePens = {};
  for (const [house, members] of Object.entries(groups)) {
    // Farrowing pens hold one sow with her litter; elsewhere six pigs share a pen.
    const pensNeeded = house === 'Farrowing House' ? members.filter(p => p.kind === 'sow').length || 1 : Math.ceil(members.length / 6);
    const capacity = Math.min(200, pensNeeded + 2);
    const { rows: [row] } = await client.query(
      `INSERT INTO rows (name, farm_id, description, levels, capacity) VALUES ($1, $2, $3, ARRAY['A'], $4) RETURNING id`,
      [house, farmId, TAG, capacity]
    );
    const pens = await bulkInsert(client, 'pens', ['row_id', 'farm_id', 'name', 'level', 'position'],
      Array.from({ length: capacity }, (_, i) => [row.id, farmId, `${house.split(' ')[0]}-A${i + 1}`, 'A', i + 1]), 'id');
    housePens[house] = pens.map(pen => pen.id);
    if (house === 'Farrowing House') {
      const sowsHere = members.filter(p => p.kind === 'sow');
      sowsHere.forEach((sow, i) => { penOf[sow.tag] = pens[i].id; });
      members.filter(p => p.kind !== 'sow').forEach(piglet => { penOf[piglet.tag] = penOf[piglet.mother] ?? pens[0].id; });
    } else {
      members.forEach((pig, i) => { penOf[pig.tag] = pens[Math.floor(i / 6)].id; });
    }
  }

  // Pigs: breeding stock first so litters can reference their parents.
  const ordered = [...pigs].sort((a, b) => (a.kind === 'grower') - (b.kind === 'grower'));
  await bulkInsert(client, 'pigs',
    ['farm_id', 'pig_id', 'name', 'gender', 'breed', 'color', 'birth_date', 'weight', 'pen_id', 'parent_male_id', 'parent_female_id',
      'acquisition_type', 'acquisition_date', 'acquisition_cost', 'is_pregnant', 'pregnancy_start_date', 'expected_birth_date', 'status', 'is_deleted', 'created_at'],
    ordered.map(pig => [
      farmId, pig.tag, pig.name, pig.gender, pig.breed, pick(['white', 'pink', 'spotted', 'brown']), iso(pig.birth),
      pig.removed ? pig.removed.weight ?? 60 : pig.weight, pig.removed ? null : penOf[pig.tag] ?? null,
      pig.father ?? null, pig.mother ?? null,
      pig.kind === 'grower' ? 'birth' : 'purchase', iso(pig.acquired), pig.kind === 'grower' ? null : between(25000, 45000),
      Boolean(pig.pregnantFrom), pig.pregnantFrom ? iso(pig.pregnantFrom) : null, pig.expected ? iso(pig.expected) : null,
      pig.removed ? (pig.removed.reason === 'sale' ? 'sold' : 'deceased') : (rand() < 0.03 ? 'sick' : 'active'),
      pig.removed ? 1 : 0, pig.acquired,
    ]));
  await client.query(
    `UPDATE pens pn SET is_occupied = EXISTS (SELECT 1 FROM pigs p WHERE p.pen_id = pn.id AND p.is_deleted = 0) WHERE pn.farm_id = $1`,
    [farmId]
  );
  await bulkInsert(client, 'pen_pig_history', ['pen_id', 'pig_id', 'farm_id', 'assigned_at'],
    live.filter(pig => penOf[pig.tag]).map(pig => [penOf[pig.tag], pig.tag, farmId, pig.acquired]));

  // Breeding records, litters and birth history.
  const bred = await bulkInsert(client, 'breeding_records',
    ['farm_id', 'sow_id', 'boar_id', 'mating_date', 'expected_birth_date', 'actual_birth_date', 'number_of_piglets', 'alert_date', 'notes'],
    breeding.map(b => [farmId, b.sow, b.boar, iso(b.mating), iso(b.expected), b.actual ? iso(b.actual) : null, b.litter, iso(addDays(b.mating, 21)), TAG]),
    'id');
  breeding.forEach((b, i) => { b.id = bred[i].id; });
  await bulkInsert(client, 'pig_birth_history', ['farm_id', 'sow_id', 'breeding_record_id', 'birth_date', 'number_of_piglets', 'notes'],
    breeding.filter(b => b.actual).map(b => [farmId, b.sow, b.id, iso(b.actual), b.litter, TAG]));
  await bulkInsert(client, 'piglet_records',
    ['breeding_record_id', 'farm_id', 'piglet_number', 'birth_weight', 'gender', 'status', 'weaning_date', 'weaning_weight', 'parent_male_id', 'parent_female_id', 'notes'],
    piglets.map(p => [p.record.id, farmId, p.number, p.birthWeight, p.gender, p.status, iso(addDays(p.record.actual, 56)), p.weaningWeight, p.record.boar, p.record.sow, TAG]));

  // Sales and deaths.
  const removed = pigs.filter(pig => pig.removed);
  await bulkInsert(client, 'removal_records', ['pig_id', 'pen_id', 'farm_id', 'reason', 'notes', 'date', 'sale_amount', 'sale_weight', 'sold_to'],
    removed.map(pig => [pig.tag, null, farmId, pig.removed.reason, TAG, iso(pig.removed.date), pig.removed.amount ?? null, pig.removed.weight ?? null, pig.removed.buyer ?? null]));
  const income = removed.filter(pig => pig.removed.reason === 'sale').map(pig => [
    farmId, 'pig_sale', pig.tag, pig.removed.amount, 'KES', iso(pig.removed.date), pig.removed.weight, 'live', pig.removed.buyer, `${TAG}`,
  ]);
  for (let month = 0; month < 12; month += 1) {
    const date = addDays(start, month * 30 + between(5, 25));
    if (date > today) continue;
    income.push([farmId, 'manure_sale', null, between(2500, 7000), 'KES', iso(date), null, 'bulk', pick(['Greenhouse farmer', 'Neighbour', 'Biogas group']), TAG]);
    if (month % 3 === 0) income.push([farmId, 'urine_sale', null, between(800, 2000), 'KES', iso(date), null, 'bulk', 'Horticulture farm', TAG]);
  }
  await bulkInsert(client, 'earnings_records', ['farm_id', 'type', 'pig_id', 'amount', 'currency', 'date', 'weight', 'sale_type', 'buyer_name', 'notes'], income);

  // Health programme: iron on day 3, deworming at weaning, erysipelas at 10 weeks,
  // breeding stock dewormed every 3 months and boosted for erysipelas every 6 months.
  const health = [];
  const healthRow = (pig, type, description, date, nextDue, vet) => [
    farmId, pig.tag, type, description, iso(date), nextDue ? iso(nextDue) : null,
    date > today ? 'scheduled' : 'completed', vet, null,
  ];
  for (const pig of pigs.filter(p => p.kind === 'grower')) {
    const end = pig.removed?.date ?? addDays(today, 60);
    const events = [
      [3, 'medication', 'Iron dextran injection'],
      [56, 'medication', 'Deworming (Ivermectin)'],
      [70, 'vaccination', 'Erysipelas vaccine'],
    ];
    for (const [day, type, description] of events) {
      const date = addDays(pig.birth, day);
      if (date <= end && date <= addDays(today, 30)) health.push(healthRow(pig, type, description, date, null, pick([null, 'Dr. Njoroge'])));
    }
    if (rand() < 0.08) {
      const date = addDays(pig.birth, between(20, 120));
      if (date <= today && date <= end) health.push(healthRow(pig, 'treatment', pick(['Scours treatment', 'Respiratory infection', 'Mange treatment']), date, null, 'Dr. Wambui'));
    }
  }
  for (const pig of pigs.filter(p => p.kind !== 'grower')) {
    for (let date = addDays(start, between(5, 30)); date <= today; date = addDays(date, 90)) {
      const next = addDays(date, 90);
      health.push(healthRow(pig, 'medication', 'Deworming (Ivermectin)', date, next > today ? next : null, 'Dr. Njoroge'));
    }
    for (let date = addDays(start, between(10, 60)); date <= today; date = addDays(date, 180)) {
      const next = addDays(date, 180);
      health.push(healthRow(pig, 'vaccination', 'Erysipelas booster', date, next > today ? next : null, 'Dr. Njoroge'));
    }
  }
  await bulkInsert(client, 'health_records',
    ['farm_id', 'pig_id', 'type', 'description', 'date', 'next_due', 'status', 'veterinarian', 'notes'], health);

  // Daily feeding per house, and feed bought every two weeks.
  const feeding = [];
  const purchasesNeeded = {};
  const breedingByDay = day => ({
    lactating: new Set(breeding.filter(b => b.actual && b.actual <= day && addDays(b.actual, 56) > day).map(b => b.sow)),
    pregnant: new Set(breeding.filter(b => b.mating <= day && (b.actual ?? b.expected) > day).map(b => b.sow)),
  });
  const houseFor = { boar: 'Boar Pens', lactating_sow: 'Farrowing House', pregnant_sow: 'Sow House', dry_sow: 'Sow House',
    piglet: 'Farrowing House', weaner: 'Weaner House', grower: 'Grower House', finisher: 'Finisher House' };
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const { lactating: lac, pregnant: preg } = breedingByDay(day);
    const totals = {};
    for (const pig of pigs) {
      if (pig.acquired > day || (pig.removed && pig.removed.date <= day)) continue;
      const stage = stageOn(pig, day, lac, preg);
      const [feed, kg] = RATIONS[stage];
      const key = `${houseFor[stage]}|${feed}`;
      totals[key] ??= { kg: 0, pigs: 0 };
      totals[key].kg += kg;
      totals[key].pigs += 1;
    }
    for (const [key, total] of Object.entries(totals)) {
      const [house, feed] = key.split('|');
      const penId = (housePens[house] ?? housePens['Sow House'] ?? Object.values(housePens)[0])[0];
      const actualKg = Math.round(total.kg * (0.92 + rand() * 0.12) * 10) / 10;
      feeding.push([farmId, penId, feed, String(actualKg), 'kg', new Date(day.getTime() + 7 * 3600_000), 'daily', total.pigs, user.id, TAG]);
      purchasesNeeded[feed] = (purchasesNeeded[feed] ?? 0) + actualKg;
    }
  }
  await bulkInsert(client, 'feeding_records',
    ['farm_id', 'pen_id', 'feed_type', 'amount', 'unit', 'feeding_time', 'record_type', 'pigs_count', 'fed_by', 'notes'], feeding);

  const purchases = [];
  for (const [feed, kg] of Object.entries(purchasesNeeded)) {
    const fortnights = 26;
    const bagsEach = Math.max(1, Math.ceil((kg * 1.08) / 70 / fortnights));
    for (let n = 0; n < fortnights; n += 1) {
      const date = addDays(start, n * 14);
      purchases.push([farmId, feed, pick(['Unga Farm Care', 'Pembe', 'Sigma Feeds']), bagsEach, 'bag_70kg',
        BAG_PRICE[feed] + between(-150, 250), iso(date), pick(['Agrovet Nyeri', 'Kenya Farmers Association', 'Local stockist']), TAG]);
    }
  }
  await bulkInsert(client, 'feed_inventory',
    ['farm_id', 'feed_type', 'brand', 'quantity', 'unit', 'cost_per_unit', 'purchase_date', 'supplier', 'notes'], purchases);

  return { pigs: pigs.length, live: live.length, litters: breeding.filter(b => b.actual).length, health: health.length, feeding: feeding.length, income: income.length, purchases: purchases.length };
};

/** Monthly M-Pesa subscription payments (mostly successful) and the matching subscriptions. */
const seedPayments = async (client, userId, farmId, since, plan) => {
  await client.query(`DELETE FROM subscriptions WHERE payment_id IN (SELECT id FROM payments WHERE user_id = $1 AND metadata->>'seed' = 'true')`, [userId]);
  await client.query(`DELETE FROM payments WHERE user_id = $1 AND metadata->>'seed' = 'true'`, [userId]);
  // The registration trial must predate the simulated payments, or it would be the "current" subscription.
  await client.query(
    `UPDATE subscriptions SET created_at = $2, trial_start_date = $2, trial_end_date = $2::timestamptz + INTERVAL '30 days'
     WHERE user_id = $1 AND payment_id IS NULL AND status = 'trial'`,
    [userId, addDays(since, -30)]
  );
  const { rows: [planRow] } = await client.query('SELECT id, price, currency FROM subscription_plans WHERE name = $1', [plan]);
  const rate = Number(process.env.USD_TO_KES_RATE) || 130;
  const amount = Math.round(Number(planRow.price) * (planRow.currency === 'USD' ? rate : 1));
  let expiry = null;
  for (let date = new Date(since); date <= today; date = addDays(date, 30)) {
    const failedFirst = rand() < 0.15;
    const attempts = failedFirst ? ['failed', 'success'] : ['success'];
    for (const [i, status] of attempts.entries()) {
      const created = addDays(date, i);
      const { rows: [payment] } = await client.query(
        `INSERT INTO payments (user_id, farm_id, plan, amount, currency, payment_mode, phone_number, status, checkout_request_id,
           mpesa_receipt_number, failure_reason, created_at, completed_at, metadata)
         VALUES ($1, $2, $3, $4, 'KES', 'mpesa', $5, $6, $7, $8, $9, $10, $10::timestamptz + INTERVAL '40 seconds', $11::jsonb) RETURNING id`,
        [userId, farmId, plan, amount, '2547' + between(10000000, 99999999), status, `ws_CO_${randomBytes(8).toString('hex')}`,
          status === 'success' ? `S${randomBytes(4).toString('hex').toUpperCase()}` : null,
          status === 'failed' ? pick(['Request cancelled by user', 'Insufficient funds', 'DS timeout user cannot be reached']) : null,
          created, JSON.stringify({ plan_period: 'monthly', duration_months: 1, seed: true })]
      );
      if (status === 'success') {
        const begin = expiry && expiry > created ? expiry : created;
        expiry = addDays(begin, 30);
        await client.query(
          `INSERT INTO subscriptions (user_id, plan_id, payment_id, current_plan, status, start_date, expiry_date, payment_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8)`,
          [userId, planRow.id, payment.id, plan, expiry > today ? 'active' : 'expired', begin, expiry, created]
        );
      }
    }
  }
  if (expiry && expiry > today) {
    await client.query(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $2), subscription_start = $3, subscription_end = $4 WHERE id = $1`,
      [userId, plan, since, expiry]
    );
  }
};

/** Light-weight demo farmers so the admin dashboard has a realistic customer base. */
const seedDemoFarmers = async (client, mode = 'create') => {
  if (mode === 'cleanup') {
    await client.query(`DELETE FROM activity_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@' || $1)`, [DEMO_DOMAIN]);
    await client.query(`DELETE FROM farms WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@' || $1)`, [DEMO_DOMAIN]);
    await client.query(`DELETE FROM users WHERE email LIKE '%@' || $1`, [DEMO_DOMAIN]);
    return;
  }
  const first = ['Wanjiku', 'Otieno', 'Kamau', 'Achieng', 'Mutua', 'Njeri', 'Kiprop', 'Auma', 'Mwangi', 'Chebet', 'Wafula', 'Nduta'];
  const last = ['Maina', 'Odhiambo', 'Kariuki', 'Wekesa', 'Ndungu', 'Kimani', 'Mutiso', 'Omondi', 'Gitau', 'Rotich'];
  const towns = ['Kiambu', 'Nakuru', 'Nyeri', 'Kisumu', 'Eldoret', 'Machakos', 'Meru', 'Thika', 'Nanyuki', 'Kakamega'];
  const password = randomBytes(24).toString('hex');
  for (let i = 1; i <= DEMO_FARMERS; i += 1) {
    const joined = addDays(start, between(0, 355));
    const name = `${pick(first)} ${pick(last)}`;
    const plan = pick(['free', 'standard', 'standard', 'advanced']);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password_hash, name, phone, role_id, email_verified, last_login, login_count, created_at)
       VALUES ($1, $2, $3, $4, (SELECT id FROM roles WHERE name = 'free'), true, $5, $6, $7) RETURNING id`,
      [`farmer${i}@${DEMO_DOMAIN}`, password, name, '2547' + between(10000000, 99999999),
        addDays(today, -between(0, 40)), between(3, 80), joined]
    );
    const { rows: [farm] } = await client.query(
      `INSERT INTO farms (name, location, size, currency, timezone, created_by, created_at) VALUES ($1, $2, $3, 'KES', 'Africa/Nairobi', $4, $5) RETURNING id`,
      [`${name.split(' ')[1]} Piggery ${i}`, pick(towns), between(1, 25), user.id, joined]
    );
    await client.query('UPDATE users SET farm_id = $1 WHERE id = $2', [farm.id, user.id]);
    const { rows: [row] } = await client.query(
      `INSERT INTO rows (name, farm_id, levels, capacity) VALUES ('Main House', $1, ARRAY['A'], 6) RETURNING id`, [farm.id]);
    const pens = await bulkInsert(client, 'pens', ['row_id', 'farm_id', 'name', 'level', 'position'],
      Array.from({ length: 6 }, (_, n) => [row.id, farm.id, `Main-A${n + 1}`, 'A', n + 1]), 'id');
    const herd = between(4, 30);
    await bulkInsert(client, 'pigs', ['farm_id', 'pig_id', 'gender', 'breed', 'color', 'birth_date', 'weight', 'pen_id', 'created_at'],
      Array.from({ length: herd }, (_, n) => [farm.id, `D${i}-${n + 1}`, rand() < 0.3 ? 'male' : 'female', pick(['Large White', 'Landrace', 'Duroc']),
        'white', iso(addDays(today, -between(60, 600))), between(30, 200), pens[n % 6].id, addDays(joined, between(1, 30))]));
    await client.query(`UPDATE pens pn SET is_occupied = EXISTS (SELECT 1 FROM pigs p WHERE p.pen_id = pn.id) WHERE pn.farm_id = $1`, [farm.id]);
    if (plan !== 'free') await seedPayments(client, user.id, farm.id, addDays(joined, 30), plan);
    else await client.query(`INSERT INTO subscriptions (user_id, current_plan, status, trial_start_date, trial_end_date) VALUES ($1, 'trial', $2, $3, $4)`,
      [user.id, addDays(joined, 30) > today ? 'trial' : 'expired', joined, addDays(joined, 30)]);
  }
};

const main = async () => {
  const client = await pool.connect();
  try {
    const { rows: [user] } = await client.query(
      'SELECT u.id, u.farm_id FROM users u WHERE lower(u.email) = lower($1) AND u.is_deleted = 0', [EMAIL]);
    if (!user?.farm_id) throw new Error(`No farmer with a farm found for ${EMAIL}`);
    await client.query('BEGIN');
    // Cleanup needs foreign-key cascades, so it runs before triggers are switched off.
    await cleanup(client, user.farm_id);
    await seedDemoFarmers(client, 'cleanup');
    // Bulk load without per-row triggers; derived columns are set explicitly below.
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const farm = await seedFarm(client, user, user.farm_id);
    await client.query(`UPDATE rows r SET occupied = (SELECT COUNT(*) FROM pens pn WHERE pn.row_id = r.id AND pn.is_occupied AND pn.is_deleted = 0) WHERE r.farm_id = $1`, [user.farm_id]);
    await client.query(`UPDATE pigs p SET total_litters = s.litters, total_piglets = s.piglets
      FROM (SELECT sow_id, COUNT(*) AS litters, SUM(number_of_piglets) AS piglets FROM pig_birth_history WHERE farm_id = $1 GROUP BY sow_id) s
      WHERE p.farm_id = $1 AND p.pig_id = s.sow_id`, [user.farm_id]);
    // Advanced unlocks every screen (reports and calendar included).
    await seedPayments(client, user.id, user.farm_id, addDays(today, -180), 'advanced');
    await seedDemoFarmers(client);
    await client.query('COMMIT');
    console.log(`Sample data loaded for ${EMAIL}:`, farm);
    console.log(`Plus ${DEMO_FARMERS} demo farmers (@${DEMO_DOMAIN}) with payments for the admin dashboard.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main();
