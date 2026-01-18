import AuthService from '../services/auth.services.js';
import logger from '../middleware/logger.js';
import { SuccessResponse } from '../middleware/responses.js';
import { ValidationError } from '../middleware/errors.js';
import { pool } from '../config/database.js';
import fs from 'fs';
import path from 'path';

class AuthController {
    static async register(req, res, next) {
        try {
            const user = await AuthService.register(req.body);
            return SuccessResponse(res, 201, 'Registration successful! Please check your email to verify your account.', user);
        } catch (error) {
            logger.error(`Register error: ${error.message}`);
            next(error);
        }
    }

    static async login(req, res, next) {
        try {
            const { email, password } = req.body;
            const result = await AuthService.login({ email, password });

            // Check if email verification is required
            const message = !result.user.email_verified
                ? 'Login successful, but please verify your email to receive notifications.'
                : 'Login successful';

            const responseData = {
                ...result,
                requires_email_verification: !result.user.email_verified
            };

            return SuccessResponse(res, 200, message, responseData);
        } catch (error) {
            logger.error(`Login error: ${error.message}`);
            next(error);
        }
    }

    static async verifyEmail(req, res, next) {
        try {
            const { token } = req.params;
            const result = await AuthService.verifyEmail(token);

            // Load success template and render
            const html = AuthController.renderSuccessTemplate(result.message, result.user.name);
            res.status(200).send(html);
        } catch (error) {
            logger.error(`Verify email error: ${error.message}`);

            // Load error template and render
            const html = AuthController.renderErrorTemplate(error.message);
            res.status(400).send(html);
        }
    }

    static renderSuccessTemplate(message, userName) {
        try {
            const successTemplatePath = path.join(process.cwd(), 'src', 'templates', 'email-verification-success.html');
            const successTemplate = fs.readFileSync(successTemplatePath, 'utf8');

            return successTemplate
                .replace(/{{message}}/g, message)
                .replace(/{{userName}}/g, userName)
                .replace(/{{appName}}/g, 'Pig Farm')
                .replace(/{{year}}/g, new Date().getFullYear());
        } catch (error) {
            logger.error(`Error loading success template: ${error.message}`);
        }
    }

    static renderErrorTemplate(errorMessage) {
        try {
            const errorTemplatePath = path.join(process.cwd(), 'src', 'templates', 'email-verification-error.html');
            const errorTemplate = fs.readFileSync(errorTemplatePath, 'utf8');

            return errorTemplate
                .replace(/{{errorMessage}}/g, errorMessage || 'The verification link is invalid or has expired.')
                .replace(/{{appName}}/g, 'Pig Farm')
                .replace(/{{year}}/g, new Date().getFullYear());
        } catch (error) {
            logger.error(`Error loading error template: ${error.message}`);
        }
    }

    static async resendVerificationEmail(req, res, next) {
        try {
            const { email } = req.body;
            const result = await AuthService.resendVerificationEmail(email);

            return SuccessResponse(res, 200, result.message, { success: result.success });
        } catch (error) {
            logger.error(`Resend verification error: ${error.message}`);
            next(error);
        }
    }

    static async validateResetToken(req, res, next) {
        try {
            const { token } = req.params;
            if (!token) {
                throw new ValidationError('Missing reset token');
            }

            const resetResult = await pool.query(
                `SELECT user_id
         FROM password_resets
         WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP AND used = false AND is_deleted = 0`,
                [token]
            );

            if (resetResult.rows.length === 0) {
                throw new ValidationError('Invalid or expired reset token');
            }

            return SuccessResponse(res, 200, 'Token is valid', { valid: true });
        } catch (error) {
            logger.error(`Validate reset token error: ${error.message}`);
            next(error);
        }
    }

    static async forgotPassword(req, res, next) {
        try {
            const { email } = req.body;
            const result = await AuthService.forgotPassword(email);
            return SuccessResponse(res, 200, 'Password reset email sent', result);
        } catch (error) {
            logger.error(`Forgot password error: ${error.message}`);
            next(error);
        }
    }

    static async resetPassword(req, res, next) {
        try {
            const { token } = req.params;
            const { password, newPassword } = req.body;
            const result = await AuthService.resetPassword({ token, password, newPassword });
            return SuccessResponse(res, 200, 'Password reset successfully', result);
        } catch (error) {
            logger.error(`Reset password error: ${error.message}`);
            next(error);
        }
    }

    static async logout(req, res, next) {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            const result = await AuthService.logout(token);
            return SuccessResponse(res, 200, 'Logged out successfully', result);
        } catch (error) {
            logger.error(`Logout error: ${error.message}`);
            next(error);
        }
    }

    static async ssoAuth(req, res, next) {
        try {
            const { email, name, image_url, provider } = req.body;
            const result = await AuthService.ssoAuth({ email, name, image_url, provider });

            const message = result.user.farm_id 
            ? 'SSO authentication successful' 
            : 'SSO authentication successful. Please create or join a farm to continue.';

            return SuccessResponse(res, 200, message, result);
        } catch (error) {
            logger.error(`SSO auth error: ${error.message}`);
            next(error);
        }
    }
}

export default AuthController;