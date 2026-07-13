import { env } from '../../../config/env.js';
import type { SmsDispatcher, SmsDispatchInput, SmsDispatchResult } from '../interfaces.js';
import { logger } from '../../../lib/logger.js';
import { twilioService } from '../../../lib/twilio.js';
import { randomUUID } from 'node:crypto';

export class TwilioSmsDispatcher implements SmsDispatcher {
  async dispatch(input: SmsDispatchInput): Promise<SmsDispatchResult> {
    logger.info('[TwilioSmsDispatcher] dispatch SMS request', {
      phoneNumber: input.phoneNumber,
      bypass: env.AUTH_BYPASS_OTP_VERIFICATION
    });

    const isProduction = env.NODE_ENV === 'production';
    if (env.AUTH_BYPASS_OTP_VERIFICATION || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
      if (isProduction) {
        throw new Error('Twilio credentials and OTP verification must be configured in production');
      }
      const simulatedMessageId = `simulated-twilio-${randomUUID()}`;
      logger.info('[TwilioSmsDispatcher] Verification Bypassed / Missing Credentials. Skipping actual send.', {
        simulatedMessageId
      });
      return {
        providerMessageId: simulatedMessageId,
        status: 'simulated_success',
        responseRaw: JSON.stringify({ message: 'Simulated send success, bypassed' })
      };
    }

    try {
      const result = await twilioService.sendSms(input.phoneNumber, input.message);
      return {
        providerMessageId: result.sid,
        status: result.status,
        responseRaw: JSON.stringify(result)
      };
    } catch (error: any) {
      logger.error('[TwilioSmsDispatcher] Error dispatching SMS via twilioService', { error: error.message });
      return {
        status: 'failed',
        responseRaw: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
export const twilioSmsDispatcher = new TwilioSmsDispatcher();
