import { sendBrevoEmail } from '../../../lib/email/providers/brevo/client.js';
import { env } from '../../../config/env.js';
import type { EmailDispatcher, EmailDispatchInput, EmailDispatchResult } from '../interfaces.js';
import { logger } from '../../../lib/logger.js';
import { randomUUID } from 'node:crypto';

export class BrevoEmailDispatcher implements EmailDispatcher {
  async dispatch(input: EmailDispatchInput): Promise<EmailDispatchResult> {
    logger.info('[BrevoEmailDispatcher] dispatch email request', {
      to: input.to,
      subject: input.subject,
      bypass: env.AUTH_BYPASS_EMAIL_VERIFICATION
    });

    const isProduction = env.NODE_ENV === 'production';
    if ((env.AUTH_BYPASS_EMAIL_VERIFICATION && !isProduction) || !env.BREVO_API_KEY) {
      if (isProduction && !env.BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY must be configured in production');
      }
      const simulatedMessageId = `simulated-brevo-${randomUUID()}`;
      logger.info('[BrevoEmailDispatcher] Verification Bypassed / No API Key. Skipping actual send.', {
        simulatedMessageId
      });
      return {
        providerMessageId: simulatedMessageId,
        status: 'simulated_success',
        responseRaw: JSON.stringify({ message: 'Simulated send success, bypassed' })
      };
    }

    try {
      const response = await sendBrevoEmail({
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent || null,
        fromEmail: input.fromEmail,
        fromName: input.fromName
      } as any);

      return {
        providerMessageId: response.messageId,
        status: response.messageId ? 'sent' : 'unknown',
        responseRaw: JSON.stringify(response)
      };
    } catch (error: any) {
      logger.error('[BrevoEmailDispatcher] Failed to send email via Brevo client', { error });
      return {
        status: 'failed',
        responseRaw: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
export const brevoEmailDispatcher = new BrevoEmailDispatcher();
