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
    // role_id: Joi.number().integer().positive().required().messages({
    //     'number.base': 'Role ID must be a number',
    //     'number.positive': 'Role ID must be a positive number',
    //     'any.required': 'Role ID is required'
    // }),
    farm_id: Joi.string().uuid().optional().allow(null).messages({
        'string.uuid': 'Farm ID must be a valid UUID'
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