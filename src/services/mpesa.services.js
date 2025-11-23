// services/mpesa.service.js
import { Buffer } from 'buffer';
import dotenv from 'dotenv';
import logger from '../middleware/logger.js';
import axios from 'axios';

dotenv.config();

class MpesaService {
  static async getAccessToken() {
    try {
      const url = process.env.MPESA_ENV === 'production' 
        ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials' 
        : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
      
      const authHeader = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
      ).toString('base64');
      
      logger.debug(`Auth Header: Basic ${authHeader}`);
      
      const response = await axios.get(url, {
        headers: {
          Authorization: `Basic ${authHeader}`
        }
      });
      
      logger.debug(`Access Token Response: ${JSON.stringify(response.data)}`);
      return response.data.access_token;
    } catch (error) {
      logger.error(`Error getting M-Pesa access token: ${error.message} - Status: ${error.response?.status} - Data: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  static generateMpesaPassword() {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/T/, '')
      .replace(/\..+/, '') // Remove milliseconds and Z
      .substring(0, 14);
    
    const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${passkey}${timestamp}`
    ).toString('base64');
    
    logger.debug(`Generated Password Components: Shortcode=${process.env.MPESA_SHORTCODE}, Timestamp=${timestamp}`);
    logger.debug(`Generated Password: ${password}`);
    
    return { password, timestamp };
  }

  static async initiateSTKPush(phoneNumber, amount, reference, description) {
    try {
      // Validate phone number format
      const cleanPhone = phoneNumber.toString().replace(/\D/g, '');
      if (!cleanPhone.startsWith('254') || cleanPhone.length !== 12) {
        throw new Error(`Invalid phone number format: ${phoneNumber}. Expected format: 254XXXXXXXXX`);
      }

      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generateMpesaPassword();
      
      const url = process.env.MPESA_ENV === 'production' 
        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest' 
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
      
      // Ensure amount is a positive integer
      const processedAmount = Math.max(1, Math.round(Number(amount)));
      
      const bodyData = {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: processedAmount,
        PartyA: cleanPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: cleanPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://e067abdeea34.ngrok-free.app',
        AccountReference: reference || 'account',
        TransactionDesc: description || 'Payment'
      };
      
      logger.debug(`STK Push Request URL: ${url}`);
      logger.debug(`STK Push Request Payload: ${JSON.stringify(bodyData, null, 2)}`);
      logger.debug(`Authorization Token (first 20 chars): ${accessToken.substring(0, 20)}...`);
      
      const response = await axios.post(url, bodyData, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });
      
      logger.debug(`STK Push Response: ${JSON.stringify(response.data, null, 2)}`);
      
      if (response.data.ResponseCode !== '0') {
        throw new Error(`M-Pesa STK Push failed: ${response.data.ResponseDescription || response.data.errorMessage || 'Unknown error'}`);
      }
      
      logger.info(`M-Pesa STK Push initiated successfully for reference ${reference}`);
      return response.data.CheckoutRequestID;
    } catch (error) {
      // Enhanced error logging
      if (error.response) {
        logger.error(`M-Pesa API Error Response:`);
        logger.error(`Status: ${error.response.status}`);
        logger.error(`Headers: ${JSON.stringify(error.response.headers)}`);
        logger.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
      } else if (error.request) {
        logger.error(`No response received from M-Pesa API`);
        logger.error(`Request: ${JSON.stringify(error.request)}`);
      } else {
        logger.error(`Error setting up M-Pesa request: ${error.message}`);
      }
      throw error;
    }
  }

  static async querySTKPush(checkoutRequestID) {
    try {
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generateMpesaPassword();
      
      const url = process.env.MPESA_ENV === 'production' 
        ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query' 
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';
      
      const bodyData = {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestID
      };
      
      logger.debug(`STK Query Request Payload: ${JSON.stringify(bodyData)}`);
      
      const response = await axios.post(url, bodyData, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      logger.debug(`STK Query Response: ${JSON.stringify(response.data)}`);
      
      if (response.data.ResponseCode !== '0') {
        throw new Error(`M-Pesa STK Query failed: ${response.data.errorMessage || 'Unknown error'}`);
      }
      
      logger.info(`M-Pesa STK Query successful for CheckoutRequestID ${checkoutRequestID}`);
      return response.data;
    } catch (error) {
      logger.error(`Error querying M-Pesa STK Push: ${error.message} - Status: ${error.response?.status} - Data: ${JSON.stringify(error.response?.data)}`);
      throw error;
    }
  }

  static processCallback(callbackData) {
    try {
      const { Body } = callbackData;
      if (!Body || !Body.stkCallback) {
        throw new Error('Invalid callback data format');
      }

      const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc } = Body.stkCallback;

      if (ResultCode === 0) {
        const callbackMetadata = Body.stkCallback.CallbackMetadata?.Item || [];
        const amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
        const mpesaReceiptNumber = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
        const balance = callbackMetadata.find(item => item.Name === 'Balance')?.Value;
        const transactionDate = callbackMetadata.find(item => item.Name === 'TransactionDate')?.Value;
        const phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;

        logger.info(`M-Pesa callback processed successfully for CheckoutRequestID: ${CheckoutRequestID}`);
        return {
          success: true,
          merchantRequestID: MerchantRequestID,
          checkoutRequestID: CheckoutRequestID,
          resultCode: ResultCode,
          resultDesc: ResultDesc,
          amount,
          mpesaReceiptNumber,
          balance,
          transactionDate,
          phoneNumber
        };
      } else {
        logger.warn(`M-Pesa callback processed with failure for CheckoutRequestID: ${CheckoutRequestID}: ${ResultDesc}`);
        return {
          success: false,
          merchantRequestID: MerchantRequestID,
          checkoutRequestID: CheckoutRequestID,
          resultCode: ResultCode,
          resultDesc: ResultDesc
        };
      }
    } catch (error) {
      logger.error(`Error processing M-Pesa callback: ${error.message}`);
      throw error;
    }
  }

  // Future methods for expansion
  static async paybill(/* Add params like shortcode, accountNumber, amount, etc. */) {
    throw new Error('Paybill method not implemented yet');
  }

  static async b2b(/* Add params like initiator, securityCredential, commandID, senderShortCode, receiverShortCode, amount, etc. */) {
    throw new Error('B2B method not implemented yet');
  }

  static async transactionStatus(/* params */) {
    throw new Error('Transaction status query not implemented yet');
  }
}

export default MpesaService;