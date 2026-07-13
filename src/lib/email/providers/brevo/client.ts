import { BrevoClient } from '@getbrevo/brevo';

import { env } from '../../../../config/env.js';
import { emailProviderError, emailProviderUnavailable } from '../../../errors.js';

export interface BrevoEmailAddress {
  email: string;
  name?: string;
}

export interface BrevoSendEmailInput {
  to: BrevoEmailAddress[];
  subject: string;
  htmlContent: string;
  textContent?: string | null;
  tags?: string[];
  replyTo?: BrevoEmailAddress | null;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface BrevoSendEmailResult {
  messageId?: string;
  messageIds?: string[];
}

let brevoClientInstance: BrevoClient | null = null;

function getBrevoClient(): BrevoClient {
  if (!env.BREVO_API_KEY) {
    throw emailProviderUnavailable('BREVO_API_KEY is not configured');
  }
  if (!brevoClientInstance) {
    brevoClientInstance = new BrevoClient({ apiKey: env.BREVO_API_KEY });
  }
  return brevoClientInstance;
}

export async function sendBrevoEmail(input: BrevoSendEmailInput): Promise<BrevoSendEmailResult> {
  const client = getBrevoClient();

  try {
    const response = await client.transactionalEmails.sendTransacEmail({
      sender: {
        name: env.EMAIL_FROM_NAME,
        email: env.EMAIL_FROM_ADDRESS
      },
      to: input.to.map((t) => ({ email: t.email, name: t.name })),
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent ?? undefined,
      replyTo: input.replyTo 
        ? { email: input.replyTo.email, name: input.replyTo.name } 
        : (env.EMAIL_REPLY_TO ? { email: env.EMAIL_REPLY_TO, name: env.EMAIL_FROM_NAME } : undefined),
      tags: input.tags,
      params: input.params,
      headers: input.headers
    });

    return {
      messageId: response.messageId,
      messageIds: response.messageIds
    };
  } catch (error: any) {
    throw emailProviderError('Brevo send failed', error);
  }
}

export async function sendBrevoBatch(emails: BrevoSendEmailInput[]): Promise<BrevoSendEmailResult[]> {
  const results: BrevoSendEmailResult[] = [];

  for (const email of emails) {
    results.push(await sendBrevoEmail(email));
  }

  return results;
}
