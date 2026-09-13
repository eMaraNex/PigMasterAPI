import Joi from 'joi';

export const registerSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Email must be a valid email address',
        'any.required': 'Email is required'
    }),
    password: Joi.string().min(8).required().messages({
        'string.min': 'Password must be at least 8 characters long',
        'any.required': 'Password is required'
    }),
    name: Joi.string().max(100).required().messages({
        'string.max': 'Name cannot exceed 100 characters',
        'any.required': 'Name is required'
    }),
    phone: Joi.string().max(20).optional().allow(null).messages({
        'string.max': 'Phone number cannot exceed 20 characters'
    }),
    privacy_policy_accepted: Joi.boolean().valid(true).required().messages({
        'boolean.base': 'Privacy policy consent is required',
        'any.only': 'You must accept the privacy policy to create an account',
        'any.required': 'You must accept the privacy policy to create an account'
    }),
    marketing_consent: Joi.boolean().optional().default(false),
    farm_id: Joi.string().uuid().optional().allow(null).messages({
        'string.uuid': 'Farm ID must be a valid UUID'
    }),
    role_id: Joi.forbidden().messages({
        'any.unknown': 'Role assignment is not allowed during self-registration'
    })
}).strict();

export const loginSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Email must be a valid email address',
        'any.required': 'Email is required'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required'
    })
}).strict();

export const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Email must be a valid email address',
        'any.required': 'Email is required'
    })
}).strict();

export const resetPasswordSchema = Joi.object({
    password: Joi.string().min(6).required().messages({
        'string.min': 'New password must be at least 6 characters',
        'any.required': 'New password is required',
    }),
    newPassword: Joi.string().min(6).required().messages({
        'string.min': 'Confirm password must be at least 6 characters',
        'any.required': 'Confirm password is required',
    }),
}).strict();