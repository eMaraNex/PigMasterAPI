import Joi from "joi";
import {
  PEN_LEVELS,
  PEN_SIZES,
  PEN_MATERIALS,
  DEFAULT_FEATURES,
} from "./constants.js";

export const penSchema = Joi.object({
  id: Joi.string().max(50).required(),
  farm_id: Joi.string().uuid().required(),
  row_name: Joi.string().max(50).allow(null).optional(),
  level: Joi.string()
    .valid(...PEN_LEVELS)
    .required(),
  position: Joi.number().integer().positive().required(),
  size: Joi.string()
    .valid(...PEN_SIZES)
    .required(),
  material: Joi.string()
    .valid(...PEN_MATERIALS)
    .required(),
  features: Joi.array()
    .items(Joi.string())
    .allow(null)
    .default(DEFAULT_FEATURES),
  is_occupied: Joi.boolean().default(false),
  last_cleaned: Joi.date().iso().allow(null).default(null).optional(),
  created_at: Joi.date().iso().allow(null).default(null).optional(),
  updated_at: Joi.date().iso().allow(null).default(null).optional(),
  is_deleted: Joi.number().valid(0, 1).default(0),
}).strict();

export const penUpdateSchema = Joi.object({
  row_name: Joi.string().max(50).allow(null).optional(),
  level: Joi.string()
    .valid(...PEN_LEVELS)
    .optional(),
  position: Joi.number().integer().positive().optional(),
  size: Joi.string()
    .valid(...PEN_SIZES)
    .optional(),
  material: Joi.string()
    .valid(...PEN_MATERIALS)
    .optional(),
  features: Joi.array().items(Joi.string()).allow(null).optional(),
  is_occupied: Joi.boolean().optional(),
  last_cleaned: Joi.date().iso().allow(null).default(null).optional(),
})
  .strict()
  .min(1);
export const rowSchema = Joi.object({
  name: Joi.string().trim().required(),
  farm_id: Joi.string().uuid().required(),
  description: Joi.string().allow(null).optional(),
  capacity: Joi.number().integer().min(1).required(),
  levels: Joi.array().items(Joi.string()).min(1).required(),
});

export const rowUpdateSchema = Joi.object({
  description: Joi.string().allow(null).required(),
});

export const rowExpandSchema = Joi.object({
  name: Joi.string().trim().required(),
  farm_id: Joi.string().uuid().required(),
  additionalCapacity: Joi.number().integer().min(1).required(),
  capacity: Joi.number().integer().min(1),
  levels: Joi.array().items(Joi.string()).min(1),
});

export const pigSchema = Joi.object({
  farm_id: Joi.string().uuid().required(),
  pig_id: Joi.string().required(),
  name: Joi.string().allow(null),
  gender: Joi.string().valid("male", "female").required(),
  breed: Joi.string().required(),
  color: Joi.string().required(),
  birth_date: Joi.date().required(),
  weight: Joi.number().required(),
  pen_id: Joi.string().allow(null),
  is_pregnant: Joi.boolean(),
  pregnancy_start_date: Joi.date().allow(null),
  expected_birth_date: Joi.date().allow(null),
  status: Joi.string(),
  notes: Joi.string().allow(null),
  parent_male_id: Joi.string().allow(null),
  parent_female_id: Joi.string().allow(null),
  pen_name: Joi.string().allow(null),
});

export const pigUpdateSchema = Joi.object({
  name: Joi.string().allow(null),
  gender: Joi.string().valid("male", "female"),
  breed: Joi.string(),
  color: Joi.string(),
  birth_date: Joi.date(),
  weight: Joi.number(),
  pen_id: Joi.string().allow(null),
  is_pregnant: Joi.boolean(),
  pregnancy_start_date: Joi.date().allow(null),
  expected_birth_date: Joi.date().allow(null),
  status: Joi.string(),
  notes: Joi.string().allow(null),
  parent_male_id: Joi.string().allow(null),
  parent_female_id: Joi.string().allow(null),
});

export const pigDeleteSchema = Joi.object({
  pig_id: Joi.string().max(20).required(),
  pen_id: Joi.string().max(50).required(),
  farm_id: Joi.string().uuid().required(),
  reason: Joi.string().max(100).required(),
  notes: Joi.string().max(1000).allow("", null).optional(),
  date: Joi.date().iso().required(),
  sale_amount: Joi.number().precision(2).optional(),
  sale_weight: Joi.number().precision(2).optional(),
  sold_to: Joi.string().max(100).allow("", null).optional(),
  sale_notes: Joi.string().max(1000).allow("", null).optional(),
  currency: Joi.string().length(3).optional(),
  sale_type: Joi.string()
    .valid("whole", "meat_only", "skin_only", "meat_and_skin")
    .optional(),
}).options({ stripUnknown: true });

export const earningsSchema = Joi.object({
  farm_id: Joi.string().uuid().required(),
  type: Joi.string()
    .valid("pig_sale", "urine_sale", "manure_sale", "other")
    .required(),
  pig_id: Joi.string().max(200).optional().allow(null), // Changed max to 200
  amount: Joi.number().positive().required(),
  currency: Joi.string()
    .length(3)
    .pattern(/^[A-Z]{3}$/)
    .default("USD"),
  date: Joi.date().required(),
  weight: Joi.number().optional().allow(null),
  sale_type: Joi.string().optional().allow(null),
  includes_urine: Joi.boolean().default(false),
  includes_manure: Joi.boolean().default(false),
  buyer_name: Joi.string().max(100).optional().allow(null),
  notes: Joi.string().optional().allow(null),
  pen_id: Joi.string().optional().allow(null),
});

export const earningsUpdateSchema = Joi.object({
  type: Joi.string()
    .valid("pig_sale", "urine_sale", "manure_sale", "other")
    .optional(),
  pig_id: Joi.string().max(200).optional().allow(null), // Changed max to 200
  amount: Joi.number().positive().optional(),
  currency: Joi.string()
    .length(3)
    .pattern(/^[A-Z]{3}$/)
    .optional(),
  date: Joi.date().optional(),
  weight: Joi.number().optional().allow(null),
  sale_type: Joi.string().optional().allow(null),
  includes_urine: Joi.boolean().optional(),
  includes_manure: Joi.boolean().optional(),
  buyer_name: Joi.string().max(100).optional().allow(null),
  notes: Joi.string().optional().allow(null),
  pen_id: Joi.string().optional().allow(null),
});

export const breedingSchema = Joi.object({
  farm_id: Joi.string().uuid().required().messages({
    "string.uuid": "farm_id must be a valid UUID",
    "any.required": "farm_id is required",
  }),
  sow_id: Joi.string().max(20).required().messages({
    "string.max": "sow_id must not exceed 20 characters",
    "any.required": "sow_id is required",
  }),
  boar_id: Joi.string().max(20).required().messages({
    "string.max": "boar_id must not exceed 20 characters",
    "any.required": "boar_id is required",
  }),
  mating_date: Joi.date().required().messages({
    "date.base": "mating_date must be a valid date",
    "any.required": "mating_date is required",
  }),
  expected_birth_date: Joi.date().allow(null).optional().messages({
    "date.base": "expected_birth_date must be a valid date",
  }),
  notes: Joi.string().allow(null).optional().messages({
    "string.base": "notes must be a string",
  }),
});

export const breedingUpdateSchema = Joi.object({
  actual_birth_date: Joi.date().allow(null).optional().messages({
    "date.base": "actual_birth_date must be a valid date",
  }),
  number_of_piglets: Joi.number()
    .integer()
    .min(0)
    .allow(null)
    .optional()
    .messages({
      "number.base": "number_of_piglets must be a number",
      "number.integer": "number_of_piglets must be an integer",
      "number.min": "number_of_piglets must be greater than or equal to 0",
    }),
  notes: Joi.string().allow(null).optional().messages({
    "string.base": "notes must be a string",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });

export const pigletSchema = Joi.object({
  breeding_record_id: Joi.string().uuid().required().messages({
    "string.uuid": "breeding_record_id must be a valid UUID",
    "any.required": "breeding_record_id is required",
  }),
  piglet_number: Joi.number().integer().min(1).required().messages({
    "number.base": "piglet_number must be a number",
    "number.integer": "piglet_number must be an integer",
    "number.min": "piglet_number must be at least 1",
    "any.required": "piglet_number is required",
  }),
  birth_weight: Joi.number()
    .precision(2)
    .positive()
    .allow(null)
    .optional()
    .messages({
      "number.base": "birth_weight must be a number",
      "number.precision": "birth_weight must have at most 2 decimal places",
      "number.positive": "birth_weight must be a positive number",
    }),
  gender: Joi.string().valid("male", "female").allow(null).optional().messages({
    "any.only": 'gender must be either "male" or "female"',
  }),
  color: Joi.string().max(50).allow(null).optional().messages({
    "string.max": "color must not exceed 50 characters",
  }),
  status: Joi.string().max(20).allow(null).optional().messages({
    "string.max": "status must not exceed 20 characters",
  }),
  notes: Joi.string().allow(null).optional().messages({
    "string.base": "notes must be a string",
  }),
});

export const pigletUpdateSchema = Joi.object({
  weaning_weight: Joi.number()
    .precision(2)
    .positive()
    .allow(null)
    .optional()
    .messages({
      "number.base": "weaning_weight must be a number",
      "number.precision": "weaning_weight must have at most 2 decimal places",
      "number.positive": "weaning_weight must be a positive number",
    }),
  status: Joi.string().max(20).allow(null).optional().messages({
    "string.max": "status must not exceed 20 characters",
  }),
  notes: Joi.string().allow(null).optional().messages({
    "string.base": "notes must be a string",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });
export const farmSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    "string.base": "Farm name must be a string",
    "string.empty": "Farm name is required",
    "string.min": "Farm name must be at least 1 character long",
    "string.max": "Farm name must be 100 characters or less",
    "any.required": "Farm name is required",
  }),
  location: Joi.string().max(200).allow("", null).optional().messages({
    "string.base": "Location must be a string",
    "string.max": "Location must be 200 characters or less",
  }),
  latitude: Joi.number().min(-90).max(90).allow(null).optional().messages({
    "number.base": "Latitude must be a number",
    "number.min": "Latitude must be at least -90",
    "number.max": "Latitude must be at most 90",
  }),
  longitude: Joi.number().min(-180).max(180).allow(null).optional().messages({
    "number.base": "Longitude must be a number",
    "number.min": "Longitude must be at least -180",
    "number.max": "Longitude must be at most 180",
  }),
  size: Joi.number().positive().allow(null).optional().messages({
    "number.base": "Size must be a number",
    "number.positive": "Size must be a positive number",
  }),
  description: Joi.string().max(500).allow("", null).optional().messages({
    "string.base": "Description must be a string",
    "string.max": "Description must be 500 characters or less",
  }),
  timezone: Joi.string().max(50).default("UTC").messages({
    "string.base": "Timezone must be a string",
    "string.max": "Timezone must be 50 characters or less",
  }),
  breeds: Joi.array()
    .items(
      Joi.string().min(1).max(100).messages({
        "string.base": "Each breed must be a string",
        "string.empty": "Breed names cannot be empty",
        "string.min": "Each breed must be at least 1 character long",
        "string.max": "Each breed must be 100 characters or less",
      })
    )
    .allow(null)
    .optional()
    .messages({
      "array.base": "Breeds must be an array",
    }),
  colors: Joi.array()
    .items(
      Joi.string().min(1).max(100).messages({
        "string.base": "Each color must be a string",
        "string.empty": "Color names cannot be empty",
        "string.min": "Each color must be at least 1 character long",
        "string.max": "Each color must be 100 characters or less",
      })
    )
    .allow(null)
    .optional()
    .messages({
      "array.base": "Colors must be an array",
    }),
});

// Farm update schema
export const farmUpdateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional().messages({
    "string.base": "Farm name must be a string",
    "string.empty": "Farm name cannot be empty",
    "string.min": "Farm name must be at least 1 character long",
    "string.max": "Farm name must be 100 characters or less",
  }),
  location: Joi.string().max(200).allow("", null).optional().messages({
    "string.base": "Location must be a string",
    "string.max": "Location must be 200 characters or less",
  }),
  latitude: Joi.number().min(-90).max(90).allow(null).optional().messages({
    "number.base": "Latitude must be a number",
    "number.min": "Latitude must be at least -90",
    "number.max": "Latitude must be at most 90",
  }),
  longitude: Joi.number().min(-180).max(180).allow(null).optional().messages({
    "number.base": "Longitude must be a number",
    "number.min": "Longitude must be at least -180",
    "number.max": "Longitude must be at most 180",
  }),
  size: Joi.number().positive().allow(null).optional().messages({
    "number.base": "Size must be a number",
    "number.positive": "Size must be a positive number",
  }),
  description: Joi.string().max(500).allow("", null).optional().messages({
    "string.base": "Description must be a string",
    "string.max": "Description must be 500 characters or less",
  }),
  timezone: Joi.string().max(50).optional().messages({
    "string.base": "Timezone must be a string",
    "string.max": "Timezone must be 50 characters or less",
  }),
  breeds: Joi.array()
    .items(
      Joi.string().min(1).max(100).messages({
        "string.base": "Each breed must be a string",
        "string.empty": "Breed names cannot be empty",
        "string.min": "Each breed must be at least 1 character long",
        "string.max": "Each breed must be 100 characters or less",
      })
    )
    .allow(null)
    .optional()
    .messages({
      "array.base": "Breeds must be an array",
    }),
  colors: Joi.array()
    .items(
      Joi.string().min(1).max(100).messages({
        "string.base": "Each color must be a string",
        "string.empty": "Color names cannot be empty",
        "string.min": "Each color must be at least 1 character long",
        "string.max": "Each color must be 100 characters or less",
      })
    )
    .allow(null)
    .optional()
    .messages({
      "array.base": "Colors must be an array",
    }),
});
export const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
    "any.required": "Email is required",
  }),
});

export const paymentSchema = Joi.object({
  plan: Joi.string().valid("standard", "advanced", "free"), // Added 'free' to match DB
  amount: Joi.number().positive(),
  currency: Joi.string().length(3).default("USD"), // Added currency, default USD
  payment_mode: Joi.string().valid(
    "mpesa",
    "dpogroup",
    "card",
    "stripe",
    "paypal"
  ),
  phone_number: Joi.string().optional(),
  metadata: Joi.object().unknown(true).optional(), // Allow any keys in metadata
  tier: Joi.string().optional(),
});

// Health records schema
export const healthSchema = Joi.object({
  pig_id: Joi.string().max(200).required(),
  type: Joi.string()
    .valid(
      "vaccination",
      "treatment",
      "checkup",
      "medication",
      "surgery",
      "other"
    )
    .required(),
  description: Joi.string().required(),
  date: Joi.date().required(),
  next_due: Joi.date().allow(null).optional(),
  status: Joi.string()
    .valid("scheduled", "completed", "pending")
    .optional()
    .default("completed"),
  veterinarian: Joi.string().max(100).allow(null).optional(),
  notes: Joi.string().allow(null).optional(),
});

export const healthUpdateSchema = Joi.object({
  type: Joi.string()
    .valid(
      "vaccination",
      "treatment",
      "checkup",
      "medication",
      "surgery",
      "other"
    )
    .optional(),
  description: Joi.string().optional(),
  date: Joi.date().optional(),
  next_due: Joi.date().allow(null).optional(),
  status: Joi.string().valid("scheduled", "completed", "pending").optional(),
  veterinarian: Joi.string().max(100).allow(null).optional(),
  notes: Joi.string().allow(null).optional(),
}).min(1);

// Feeding schedule record schema
export const feedingScheduleSchema = Joi.object({
  pig_id: Joi.string().max(200).required(),
  daily_amount: Joi.string().required(),
  feed_type: Joi.string().required(),
  // times can be an array of schedule times or a richer object (json) stored as times
  times: Joi.alternatives()
    .try(Joi.array().items(Joi.string()), Joi.object())
    .required(),
  // optional frequency fields to support recurring schedules
  frequency: Joi.string().valid("daily", "weekly", "monthly").default("daily"),
  frequency_interval: Joi.number().integer().min(1).default(1),
  days: Joi.array().items(Joi.number().integer().min(0).max(6)).optional(),
  special_diet: Joi.string().allow(null).optional(),
  last_fed: Joi.date().allow(null).optional(),
  is_active: Joi.boolean().default(false),
});

export const feedingScheduleUpdateSchema = Joi.object({
  daily_amount: Joi.string().optional(),
  feed_type: Joi.string().optional(),
  times: Joi.alternatives()
    .try(Joi.array().items(Joi.string()), Joi.object())
    .optional(),
  frequency: Joi.string().valid("daily", "weekly", "monthly").optional(),
  frequency_interval: Joi.number().integer().min(1).optional(),
  days: Joi.array().items(Joi.number().integer().min(0).max(6)).optional(),
  special_diet: Joi.string().allow(null).optional(),
  last_fed: Joi.date().allow(null).optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

// Feeding records schema
export const feedingRecordSchema = Joi.object({
  pig_id: Joi.string().max(200).allow(null).optional(),
  pen_id: Joi.string().uuid().allow(null).optional(),
  farm_id: Joi.string().uuid().required(),
  feed_type: Joi.string().required(),
  amount: Joi.string().required(),
  unit: Joi.string().default("grams"),
  feeding_time: Joi.date().required(),
  fed_by: Joi.string().uuid().allow(null).optional(),
  notes: Joi.string().allow(null).optional(),
});

export const vaccinationScheduleSchema = Joi.object({
  farm_id: Joi.string().uuid().required(),
  vaccine_name: Joi.string().max(100).required(),
  description: Joi.string().allow(null).optional(),
  frequency_days: Joi.number().integer().min(1).required(),
  age_start_days: Joi.number().integer().min(0).optional().default(0),
  is_active: Joi.boolean().default(true),
});

export const vaccinationScheduleUpdateSchema = Joi.object({
  vaccine_name: Joi.string().max(100).optional(),
  description: Joi.string().allow(null).optional(),
  frequency_days: Joi.number().integer().min(1).optional(),
  age_start_days: Joi.number().integer().min(0).optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

export const feedingRecordUpdateSchema = Joi.object({
  pig_id: Joi.string().max(200).allow(null).optional(),
  pen_id: Joi.string().uuid().allow(null).optional(),
  feed_type: Joi.string().optional(),
  amount: Joi.string().optional(),
  unit: Joi.string().optional(),
  feeding_time: Joi.date().optional(),
  fed_by: Joi.string().uuid().allow(null).optional(),
  notes: Joi.string().allow(null).optional(),
}).min(1);
