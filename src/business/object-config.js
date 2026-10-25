import Joi from 'joi';
import { schema } from './base.js';
import { pool } from '../config/database.js';
import { ValidationError } from '../middleware/errors.js';
import { expandRow, farmHooks, penHooks, rowHooks } from './hooks/farm-structure.js';
import { pigHooks, pigRemovalSchema, pigStatistics, transferPig } from './hooks/pigs.js';
import { breedingHooks, recordLitter } from './hooks/breeding.js';
import { feedingRecordHooks } from './hooks/feeding.js';
import { HEALTH_DUE_DATE_SQL, completeHealthItem, healthHooks, healthSummary, recordHealthForGroup } from './hooks/health.js';
import { todaysAlerts } from './hooks/alerts.js';

/*
 * Farmer-facing business objects. Each entry becomes a router mounted at
 * /api/v1/<path> with: GET|POST /list, GET /list/:id, POST /create,
 * PUT|PATCH /update/:id, DELETE /delete/:id, POST /export, plus the object's
 * `actions` (custom endpoints that still share auth, tenancy and auditing).
 *
 * tenant.type 'farm'  -> rows are scoped to the caller's active farm (validated ownership)
 * tenant.type 'owner' -> rows are scoped to the calling user (created_by)
 * columns             -> the only fields a client may sort, filter, search or write
 */

export const SOFT_DELETE = { column: 'is_deleted', active: 0, deleted: 1 };
const SOFT_DELETE_BOOLEAN = { column: 'is_deleted', active: 'false', deleted: 'true' };
const FARM = { type: 'farm', field: 'farm_id' };

// Sale types offered by the earnings form for pigs, manure and urine.
const SALE_TYPE = Joi.string()
  .valid('whole', 'live', 'meat_only', 'skin_only', 'meat_and_skin', 'bulk', 'processed', 'other')
  .allow(null).empty('');

const pigTag = () => Joi.string().trim().max(200).pattern(/^[\w\-./ ]+$/);
const nullablePigTag = () => pigTag().allow(null, '').empty('').default(null);

const pigFields = {
  name: schema.text(50).allow('', null),
  gender: Joi.string().valid('male', 'female'),
  breed: schema.text(50),
  color: schema.text(50),
  birth_date: schema.date().max('now'),
  weight: Joi.number().positive().max(9999),
  parent_male_id: nullablePigTag(),
  parent_female_id: nullablePigTag(),
  acquisition_type: schema.text(20).allow('', null),
  acquisition_date: schema.date().allow(null),
  acquisition_cost: schema.money().allow(null),
  is_pregnant: Joi.boolean(),
  pregnancy_start_date: schema.date().allow(null),
  expected_birth_date: schema.date().allow(null),
  status: Joi.string().valid('active', 'sick', 'quarantine', 'sold', 'deceased', 'inactive'),
  notes: schema.notes(),
};

const pigRelations = {
  pen_history: {
    sql: a => `(SELECT COALESCE(json_agg(json_build_object(
        'pen_id', h.pen_id, 'assigned_at', h.assigned_at, 'removed_at', h.removed_at,
        'removal_reason', h.removal_reason, 'removal_notes', h.removal_notes) ORDER BY h.assigned_at DESC), '[]')
      FROM pen_pig_history h WHERE h.farm_id = ${a}.farm_id AND h.pig_id = ${a}.pig_id AND h.is_deleted = 0)`,
  },
  birth_history: {
    sql: a => `(SELECT COALESCE(json_agg(json_build_object(
        'birth_date', b.birth_date, 'number_of_piglets', b.number_of_piglets,
        'breeding_record_id', b.breeding_record_id, 'notes', b.notes,
        'piglets', (SELECT COALESCE(json_agg(json_build_object(
            'id', k.id, 'piglet_number', k.piglet_number, 'birth_weight', k.birth_weight,
            'gender', k.gender, 'color', k.color, 'status', k.status)), '[]')
          FROM piglet_records k WHERE k.breeding_record_id = b.breeding_record_id AND k.is_deleted = 0)
      ) ORDER BY b.birth_date DESC), '[]')
      FROM pig_birth_history b WHERE b.farm_id = ${a}.farm_id AND b.sow_id = ${a}.pig_id AND b.is_deleted = 0)`,
  },
  health_records: {
    sql: a => `(SELECT COALESCE(json_agg(json_build_object(
        'id', hr.id, 'type', hr.type, 'description', hr.description, 'date', hr.date,
        'next_due', hr.next_due, 'status', hr.status, 'veterinarian', hr.veterinarian,
        'notes', hr.notes, 'created_at', hr.created_at) ORDER BY hr.date DESC), '[]')
      FROM health_records hr WHERE hr.farm_id = ${a}.farm_id AND hr.pig_id = ${a}.pig_id AND hr.is_deleted = 0)`,
  },
  feeding_schedule: {
    sql: a => `(SELECT json_build_object('id', fs.id, 'daily_amount', fs.daily_amount, 'feed_type', fs.feed_type,
        'times', fs.times, 'special_diet', fs.special_diet, 'last_fed', fs.last_fed, 'is_active', fs.is_active)
      FROM feeding_schedules fs WHERE fs.farm_id = ${a}.farm_id AND fs.pig_id = ${a}.pig_id AND fs.is_deleted = 0
      ORDER BY fs.created_at DESC LIMIT 1)`,
  },
};

export const farmObjectConfigs = {
  farms: {
    path: 'farms',
    table: 'farms',
    alias: 'f',
    label: 'Farm',
    tenant: { type: 'owner', field: 'created_by' },
    softDelete: SOFT_DELETE,
    requiresFarm: false,
    enforcePlan: false,
    defaultSort: { field: 'created_at', order: 'DESC' },
    messages: { duplicate: 'You already have a farm with this name' },
    columns: {
      name: { searchable: true },
      location: { searchable: true },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      size: { type: 'number' },
      description: {},
      timezone: {},
      breeds: { type: 'json', sortable: false, filterable: false },
      colors: { type: 'json', sortable: false, filterable: false },
      currency: {},
      created_at: { type: 'datetime' },
      pig_count: {
        type: 'integer',
        sql: '(SELECT COUNT(*)::int FROM pigs p WHERE p.farm_id = f.id AND p.is_deleted = 0)',
      },
    },
    schemas: {
      create: Joi.object({
        name: schema.text(100).min(1).required(),
        location: schema.text(200).allow('', null),
        latitude: Joi.number().min(-90).max(90).allow(null),
        longitude: Joi.number().min(-180).max(180).allow(null),
        size: Joi.number().min(0).max(1_000_000).allow(null),
        description: schema.notes(),
        timezone: schema.text(64).default('Africa/Nairobi'),
        breeds: Joi.array().items(schema.text(50)).max(50).default([]),
        colors: Joi.array().items(schema.text(50)).max(50).default([]),
        currency: Joi.string().pattern(/^[A-Z]{3}$/).default('KES'),
      }),
      update: Joi.object({
        name: schema.text(100).min(1),
        location: schema.text(200).allow('', null),
        latitude: Joi.number().min(-90).max(90).allow(null),
        longitude: Joi.number().min(-180).max(180).allow(null),
        size: Joi.number().min(0).max(1_000_000).allow(null),
        description: schema.notes(),
        timezone: schema.text(64),
        breeds: Joi.array().items(schema.text(50)).max(50),
        colors: Joi.array().items(schema.text(50)).max(50),
        currency: Joi.string().pattern(/^[A-Z]{3}$/),
      }).min(1),
    },
    hooks: farmHooks,
  },

  rows: {
    path: 'rows',
    table: 'rows',
    alias: 'r',
    label: 'Row',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 500,
    defaultSort: { field: 'name', order: 'ASC' },
    messages: { duplicate: 'A row with this name already exists on this farm' },
    columns: {
      name: { searchable: true },
      description: { searchable: true },
      levels: { type: 'array', filterable: false },
      capacity: { type: 'integer' },
      occupied: { type: 'integer', writable: false },
      created_at: { type: 'datetime' },
      pen_count: {
        type: 'integer',
        sql: '(SELECT COUNT(*)::int FROM pens pn WHERE pn.row_id = r.id AND pn.is_deleted = 0)',
      },
    },
    schemas: {
      create: Joi.object({
        name: schema.text(50).min(1).pattern(/^[\w\- ]+$/).required(),
        description: schema.notes(),
        capacity: Joi.number().integer().min(1).max(200).required(),
        levels: Joi.array().items(Joi.string().pattern(/^[A-Z]$/)).min(1).max(26).unique().default(['A', 'B', 'C']),
      }),
      update: Joi.object({
        description: schema.notes(),
        capacity: Joi.number().integer().min(1).max(200),
      }).min(1),
    },
    hooks: rowHooks,
    actions: [
      {
        method: 'post', path: '/expand/:id', write: true,
        handler: (ctx, req, service) => expandRow(ctx, service, req.params.id, Number(req.body?.additionalCapacity)),
      },
    ],
  },

  pens: {
    path: 'pens',
    table: 'pens',
    alias: 'pn',
    label: 'Pen',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 5000,
    defaultSort: { field: 'name', order: 'ASC' },
    messages: { duplicate: 'That pen name or row position is already taken' },
    columns: {
      name: { searchable: true },
      row_id: { type: 'uuid' },
      level: {},
      position: { type: 'integer' },
      size: {},
      material: {},
      features: { type: 'json', sortable: false, filterable: false },
      is_occupied: { type: 'boolean', writable: false },
      last_cleaned: { type: 'datetime' },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'rows', alias: 'rw', on: 'rw.id = pn.row_id', columns: { row_name: { sql: 'rw.name', searchable: true } } },
    ],
    relations: {
      pigs: {
        sql: a => `(SELECT COALESCE(json_agg(json_build_object(
            'id', p.id, 'pig_id', p.pig_id, 'name', p.name, 'gender', p.gender, 'breed', p.breed,
            'color', p.color, 'weight', p.weight, 'is_pregnant', p.is_pregnant, 'birth_date', p.birth_date)
            ORDER BY p.pig_id), '[]')
          FROM pigs p WHERE p.farm_id = ${a}.farm_id AND p.pen_id = ${a}.id AND p.is_deleted = 0)`,
      },
    },
    schemas: {
      create: Joi.object({
        row_id: schema.uuid().required(),
        level: Joi.string().pattern(/^[A-Z]$/).required(),
        position: Joi.number().integer().min(1).max(200).required(),
        name: schema.text(50),
        size: Joi.string().valid('small', 'medium', 'large').default('medium'),
        material: Joi.string().valid('wire', 'wood', 'plastic', 'metal', 'concrete').default('wire'),
        features: Joi.array().items(schema.text(50)).max(20).default(['water bottle', 'feeder']),
        last_cleaned: schema.date().allow(null),
      }),
      update: Joi.object({
        level: Joi.string().pattern(/^[A-Z]$/),
        position: Joi.number().integer().min(1).max(200),
        size: Joi.string().valid('small', 'medium', 'large'),
        material: Joi.string().valid('wire', 'wood', 'plastic', 'metal', 'concrete'),
        features: Joi.array().items(schema.text(50)).max(20),
        last_cleaned: schema.date().allow(null),
      }).min(1),
    },
    hooks: penHooks,
  },

  pigs: {
    path: 'pigs',
    table: 'pigs',
    alias: 'p',
    label: 'Pig',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 2000,
    defaultSort: { field: 'created_at', order: 'DESC' },
    messages: {
      duplicate: 'A pig with this tag already exists on this farm',
      reference: 'The pen or parent pig was not found on this farm',
    },
    columns: {
      pig_id: { searchable: true },
      name: { searchable: true },
      gender: {},
      breed: { searchable: true },
      color: { searchable: true },
      birth_date: { type: 'date' },
      weight: { type: 'number' },
      pen_id: { type: 'uuid' },
      parent_male_id: {},
      parent_female_id: {},
      acquisition_type: {},
      acquisition_date: { type: 'date' },
      acquisition_cost: { type: 'number' },
      is_pregnant: { type: 'boolean' },
      pregnancy_start_date: { type: 'date' },
      expected_birth_date: { type: 'date' },
      actual_birth_date: { type: 'date', writable: false },
      total_litters: { type: 'integer', writable: false },
      total_piglets: { type: 'integer', writable: false },
      status: {},
      notes: {},
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
    },
    joins: [
      {
        table: 'pens',
        alias: 'pp',
        on: 'pp.id = p.pen_id AND pp.farm_id = p.farm_id',
        columns: { pen_name: { sql: 'pp.name', searchable: true } },
      },
    ],
    relations: pigRelations,
    schemas: {
      create: Joi.object({
        ...pigFields,
        pig_id: pigTag().required(),
        gender: pigFields.gender.required(),
        breed: pigFields.breed.required(),
        color: pigFields.color.required(),
        birth_date: pigFields.birth_date.required(),
        weight: pigFields.weight.required(),
        pen_id: schema.uuid().allow(null, '').empty('').default(null),
        status: pigFields.status.default('active'),
        acquisition_type: pigFields.acquisition_type.default('birth'),
      }),
      // Moving a pig between pens goes through POST /pigs/transfer/:id so history is kept.
      update: Joi.object(pigFields).min(1),
      delete: pigRemovalSchema,
    },
    hooks: pigHooks,
    actions: [
      { method: 'get', path: '/statistics', handler: ctx => pigStatistics(ctx) },
      { method: 'post', path: '/transfer/:id', write: true, handler: (ctx, req, service) => transferPig(ctx, service, req.params.id, req.body) },
    ],
  },

  health_records: {
    path: 'health-records',
    table: 'health_records',
    alias: 'h',
    label: 'Health record',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 500,
    defaultSort: { field: 'date', order: 'DESC' },
    messages: { reference: 'Pig not found on this farm' },
    columns: {
      pig_id: { searchable: true },
      type: {},
      description: { searchable: true },
      date: { type: 'date' },
      next_due: { type: 'date' },
      status: {},
      veterinarian: { searchable: true },
      notes: {},
      created_at: { type: 'datetime' },
      due_date: { type: 'date', sql: HEALTH_DUE_DATE_SQL },
    },
    joins: [
      { table: 'pigs', alias: 'hp', on: 'hp.farm_id = h.farm_id AND hp.pig_id = h.pig_id', columns: { pig_name: { sql: 'hp.name', searchable: true } } },
    ],
    schemas: {
      create: Joi.object({
        pig_id: pigTag().required(),
        type: Joi.string().valid('vaccination', 'treatment', 'checkup', 'medication', 'surgery', 'other').required(),
        description: schema.text(2000).required(),
        date: schema.date().required(),
        next_due: schema.date().allow(null),
        // Left empty, the status is derived from the date (future = scheduled).
        status: Joi.string().valid('completed', 'scheduled', 'cancelled'),
        veterinarian: schema.text(100).allow('', null),
        notes: schema.notes(),
      }),
      update: Joi.object({
        type: Joi.string().valid('vaccination', 'treatment', 'checkup', 'medication', 'surgery', 'other'),
        description: schema.text(2000),
        date: schema.date(),
        next_due: schema.date().allow(null),
        status: Joi.string().valid('completed', 'scheduled', 'cancelled'),
        veterinarian: schema.text(100).allow('', null),
        notes: schema.notes(),
      }).min(1),
    },
    hooks: healthHooks,
    actions: [
      { method: 'get', path: '/summary', handler: ctx => healthSummary(ctx) },
      { method: 'post', path: '/bulk', write: true, handler: (ctx, req, service) => recordHealthForGroup(ctx, service, req.body) },
      { method: 'post', path: '/complete/:id', write: true, handler: (ctx, req, service) => completeHealthItem(ctx, service, req.params.id, req.body) },
    ],
  },

  feeding_records: {
    path: 'feeding-records',
    table: 'feeding_records',
    alias: 'fr',
    label: 'Feeding record',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 500,
    defaultSort: { field: 'feeding_time', order: 'DESC' },
    messages: { reference: 'Pig or pen not found on this farm' },
    columns: {
      record_type: {},
      pig_id: { searchable: true },
      pen_id: { type: 'uuid' },
      feed_type: { searchable: true },
      amount: {},
      unit: {},
      feeding_time: { type: 'datetime' },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      total_amount: { type: 'number' },
      pigs_in_pen: { type: 'json', sortable: false, filterable: false },
      pigs_count: { type: 'integer' },
      fed_by: { type: 'uuid' },
      notes: {},
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pens', alias: 'fpn', on: 'fpn.id = fr.pen_id', columns: { pen_name: 'fpn.name' } },
    ],
    schemas: {
      create: Joi.object({
        record_type: Joi.string().valid('daily', 'weekly', 'monthly').default('daily'),
        pig_id: nullablePigTag(),
        pen_id: schema.uuid().allow(null, '').empty('').default(null),
        feed_type: schema.text(50).required(),
        amount: Joi.alternatives(Joi.number().positive(), schema.text(50)).when('record_type', {
          is: 'daily', then: Joi.required(), otherwise: Joi.optional(),
        }),
        unit: Joi.string().valid('grams', 'kg', 'lbs').default('kg'),
        feeding_time: schema.date(),
        start_date: schema.date(),
        end_date: schema.date(),
        total_amount: Joi.number().positive().max(1_000_000),
        notes: schema.notes(),
      }),
      update: Joi.object({
        feed_type: schema.text(50),
        amount: Joi.alternatives(Joi.number().positive(), schema.text(50)),
        unit: Joi.string().valid('grams', 'kg', 'lbs'),
        feeding_time: schema.date(),
        start_date: schema.date(),
        end_date: schema.date(),
        total_amount: Joi.number().positive().max(1_000_000),
        notes: schema.notes(),
      }).min(1),
    },
    hooks: feedingRecordHooks,
  },

  feeding_schedules: {
    path: 'feeding-schedules',
    table: 'feeding_schedules',
    alias: 'fs',
    label: 'Feeding schedule',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    defaultSort: { field: 'created_at', order: 'DESC' },
    messages: { reference: 'Pig not found on this farm' },
    columns: {
      pig_id: { searchable: true },
      daily_amount: {},
      feed_type: { searchable: true },
      times: { type: 'json', sortable: false, filterable: false },
      special_diet: {},
      last_fed: { type: 'datetime' },
      is_active: { type: 'flag' },
      created_at: { type: 'datetime' },
    },
    schemas: {
      create: Joi.object({
        pig_id: pigTag().required(),
        daily_amount: schema.text(50).required(),
        feed_type: schema.text(50).required(),
        times: Joi.alternatives(Joi.array().items(Joi.string().pattern(/^\d{2}:\d{2}$/)).min(1).max(12), Joi.object()).required(),
        special_diet: schema.notes(),
        last_fed: schema.date().allow(null),
        is_active: Joi.boolean().default(true),
      }),
      update: Joi.object({
        daily_amount: schema.text(50),
        feed_type: schema.text(50),
        times: Joi.alternatives(Joi.array().items(Joi.string().pattern(/^\d{2}:\d{2}$/)).min(1).max(12), Joi.object()),
        special_diet: schema.notes(),
        last_fed: schema.date().allow(null),
        is_active: Joi.boolean(),
      }).min(1),
    },
  },

  breeding_records: {
    path: 'breeding-records',
    table: 'breeding_records',
    alias: 'br',
    label: 'Breeding record',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 500,
    defaultSort: { field: 'mating_date', order: 'DESC' },
    columns: {
      sow_id: { searchable: true },
      boar_id: { searchable: true },
      mating_date: { type: 'date' },
      expected_birth_date: { type: 'date' },
      actual_birth_date: { type: 'date' },
      number_of_piglets: { type: 'integer' },
      notes: {},
      alert_date: { type: 'date' },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pigs', alias: 'sow', on: 'sow.farm_id = br.farm_id AND sow.pig_id = br.sow_id', columns: { sow_name: 'sow.name' } },
      { table: 'pigs', alias: 'boar', on: 'boar.farm_id = br.farm_id AND boar.pig_id = br.boar_id', columns: { boar_name: 'boar.name' } },
    ],
    relations: {
      piglets: {
        inList: true,
        sql: a => `(SELECT COALESCE(json_agg(json_build_object(
            'id', k.id, 'piglet_number', k.piglet_number, 'birth_weight', k.birth_weight, 'gender', k.gender,
            'color', k.color, 'status', k.status, 'weaning_date', k.weaning_date,
            'weaning_weight', k.weaning_weight, 'notes', k.notes) ORDER BY k.piglet_number), '[]')
          FROM piglet_records k WHERE k.breeding_record_id = ${a}.id AND k.is_deleted = 0)`,
      },
    },
    schemas: {
      create: Joi.object({
        sow_id: pigTag().required(),
        boar_id: pigTag().required(),
        mating_date: schema.date().max('now').required(),
        expected_birth_date: schema.date(),
        notes: schema.notes(),
        immediate_notify_date: schema.date(),
        alert_message: schema.text(500).allow('', null),
      }),
      update: Joi.object({
        actual_birth_date: schema.date().max('now'),
        number_of_piglets: Joi.number().integer().min(0).max(30),
        notes: schema.notes(),
      }).min(1),
    },
    hooks: breedingHooks,
    actions: [
      { method: 'post', path: '/litter', write: true, handler: (ctx, req, service) => recordLitter(ctx, service, req.body) },
    ],
  },

  piglets: {
    path: 'piglets',
    table: 'piglet_records',
    alias: 'k',
    label: 'Piglet',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 500,
    operations: ['list', 'get', 'update', 'delete', 'export'],
    defaultSort: { field: 'piglet_number', order: 'ASC' },
    columns: {
      breeding_record_id: { type: 'uuid' },
      piglet_number: { searchable: true },
      birth_weight: { type: 'number' },
      gender: {},
      color: {},
      status: {},
      weaning_date: { type: 'date' },
      weaning_weight: { type: 'number' },
      parent_male_id: {},
      parent_female_id: {},
      notes: {},
      created_at: { type: 'datetime' },
    },
    schemas: {
      update: Joi.object({
        birth_weight: Joi.number().positive().max(10).allow(null),
        weaning_weight: Joi.number().positive().max(100).allow(null),
        status: Joi.string().valid('alive', 'dead', 'weaned', 'sold'),
        notes: schema.notes(),
      }).min(1),
    },
  },

  earnings: {
    path: 'earnings',
    table: 'earnings_records',
    alias: 'er',
    label: 'Earnings record',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    maxLimit: 1000,
    defaultSort: { field: 'date', order: 'DESC' },
    messages: { reference: 'Pig or pen not found on this farm' },
    columns: {
      type: {},
      pig_id: { searchable: true },
      amount: { type: 'number' },
      currency: {},
      date: { type: 'date' },
      weight: { type: 'number' },
      sale_type: {},
      includes_urine: { type: 'boolean' },
      includes_manure: { type: 'boolean' },
      buyer_name: { searchable: true },
      notes: { searchable: true },
      pen_id: { type: 'uuid' },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pigs', alias: 'ep', on: 'ep.farm_id = er.farm_id AND ep.pig_id = er.pig_id', columns: { pig_name: 'ep.name' } },
    ],
    schemas: {
      create: Joi.object({
        type: Joi.string().valid('pig_sale', 'urine_sale', 'manure_sale', 'other').required(),
        pig_id: nullablePigTag(),
        amount: schema.money().greater(0).required(),
        currency: Joi.string().pattern(/^[A-Z]{3}$/).default('KES'),
        date: schema.date().required(),
        // The form sends 0 / '' when a field does not apply; store those as NULL.
        weight: Joi.number().positive().max(100_000).allow(null).empty(0),
        sale_type: SALE_TYPE,
        includes_urine: Joi.boolean().default(false),
        includes_manure: Joi.boolean().default(false),
        buyer_name: schema.text(100).allow('', null),
        notes: schema.notes(),
        pen_id: schema.uuid().allow(null, '').empty('').default(null),
      }),
      update: Joi.object({
        type: Joi.string().valid('pig_sale', 'urine_sale', 'manure_sale', 'other'),
        pig_id: nullablePigTag(),
        amount: schema.money().greater(0),
        currency: Joi.string().pattern(/^[A-Z]{3}$/),
        date: schema.date(),
        // The form sends 0 / '' when a field does not apply; store those as NULL.
        weight: Joi.number().positive().max(100_000).allow(null).empty(0),
        sale_type: SALE_TYPE,
        includes_urine: Joi.boolean(),
        includes_manure: Joi.boolean(),
        buyer_name: schema.text(100).allow('', null),
        notes: schema.notes(),
        pen_id: schema.uuid().allow(null),
      }).min(1),
    },
  },

  alerts: {
    path: 'alerts',
    table: 'alerts',
    alias: 'al',
    label: 'Alert',
    tenant: FARM,
    softDelete: SOFT_DELETE_BOOLEAN,
    maxLimit: 1000,
    operations: ['list', 'get', 'update'],
    defaultSort: { field: 'alert_start_date', order: 'ASC' },
    audit: false,
    columns: {
      name: { searchable: true },
      alert_start_date: { type: 'datetime' },
      alert_end_date: { type: 'datetime' },
      alert_type: {},
      severity: {},
      message: { searchable: true },
      status: {},
      pig_id: {},
      pen_id: { type: 'uuid' },
      notify_on: { type: 'array', filterable: false, sortable: false },
      created_on: { type: 'datetime' },
    },
    schemas: {
      update: Joi.object({ status: Joi.string().valid('pending', 'sent', 'completed', 'rejected').required() }),
    },
    actions: [
      {
        method: 'get', path: '/today',
        handler: ctx => {
          if (!ctx.farmId) throw new ValidationError('Create or select a farm first');
          return todaysAlerts(pool, ctx.farmId);
        },
      },
    ],
  },

  removals: {
    path: 'removals',
    table: 'removal_records',
    alias: 'rr',
    label: 'Removal record',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'date', order: 'DESC' },
    columns: {
      pig_id: { searchable: true },
      pen_id: { type: 'uuid' },
      reason: {},
      notes: { searchable: true },
      date: { type: 'date' },
      sale_amount: { type: 'number' },
      sale_weight: { type: 'number' },
      sold_to: { searchable: true },
      created_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pigs', alias: 'rp', on: 'rp.farm_id = rr.farm_id AND rp.pig_id = rr.pig_id', columns: { pig_name: 'rp.name', breed: 'rp.breed', gender: 'rp.gender' } },
      { table: 'pens', alias: 'rpn', on: 'rpn.id = rr.pen_id', columns: { pen_name: 'rpn.name' } },
    ],
  },

  pen_history: {
    path: 'pen-history',
    table: 'pen_pig_history',
    alias: 'ph',
    label: 'Pen history',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'assigned_at', order: 'DESC' },
    columns: {
      pen_id: { type: 'uuid' },
      pig_id: { searchable: true },
      assigned_at: { type: 'datetime' },
      removed_at: { type: 'datetime' },
      removal_reason: {},
      removal_notes: {},
      sale_amount: { type: 'number' },
      sale_date: { type: 'date' },
      sale_weight: { type: 'number' },
      sold_to: {},
      updated_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pigs', alias: 'hpg', on: 'hpg.farm_id = ph.farm_id AND hpg.pig_id = ph.pig_id', columns: { pig_name: 'hpg.name', breed: 'hpg.breed', gender: 'hpg.gender' } },
    ],
  },

  pig_transfers: {
    path: 'pig-transfers',
    table: 'pig_transfer_history',
    alias: 'pt',
    label: 'Transfer',
    tenant: FARM,
    softDelete: SOFT_DELETE,
    operations: ['list', 'get', 'export'],
    defaultSort: { field: 'transferred_at', order: 'DESC' },
    columns: {
      pig_id: { searchable: true },
      old_pen_id: { type: 'uuid' },
      new_pen_id: { type: 'uuid' },
      transfer_reason: {},
      transfer_notes: {},
      transferred_at: { type: 'datetime' },
    },
    joins: [
      { table: 'pens', alias: 'op', on: 'op.id = pt.old_pen_id', columns: { old_pen_name: 'op.name' } },
      { table: 'pens', alias: 'np', on: 'np.id = pt.new_pen_id', columns: { new_pen_name: 'np.name' } },
      { table: 'users', alias: 'tu', on: 'tu.id = pt.transferred_by', columns: { transferred_by_user: { sql: 'tu.name', filterable: false } } },
      { table: 'pigs', alias: 'tp', on: 'tp.farm_id = pt.farm_id AND tp.pig_id = pt.pig_id', columns: { pig_name: 'tp.name' } },
    ],
  },
};
