import { db } from '../../db/client.js';
import { emailsRepository } from './repository.js';
import { signEmailActionToken, verifyEmailActionToken } from '../../lib/email/unsubscribe.js';
import { notFound, badRequest } from '../../lib/errors.js';

export class PreferencesService {
  async getPreferences(tenantId: string, email: string, userId?: string | null) {
    let prefs = await emailsRepository.findPreferencesByEmail(db, tenantId, email);
    if (!prefs) {
      prefs = await emailsRepository.upsertPreferences(db, tenantId, email, {
        userId: userId || null,
        marketing: true,
        campaign: true,
        notification: true
      });
    }
    return prefs;
  }

  async getPreferencesByToken(token: string) {
    const payload = verifyEmailActionToken(token);
    if (!payload) {
      throw badRequest('Invalid or expired unsubscribe token');
    }
    
    return this.getPreferences(payload.tenantId, payload.email);
  }

  async updatePreferences(tenantId: string, email: string, data: { marketing?: boolean; campaign?: boolean; notification?: boolean }) {
    const updated = await emailsRepository.upsertPreferences(db, tenantId, email, data);
    
    await emailsRepository.recordAudit(db, {
      tenantId,
      action: 'preference_change',
      email,
      metadata: data
    });

    return updated;
  }

  async unsubscribeOneClick(token: string) {
    const payload = verifyEmailActionToken(token);
    if (!payload) {
      throw badRequest('Invalid or expired unsubscribe token');
    }

    // Disable all marketing / campaigns / notifications for one-click unsubscribe
    const updated = await this.updatePreferences(payload.tenantId, payload.email, {
      marketing: false,
      campaign: false,
      notification: false
    });

    // Add email to suppressions list
    await emailsRepository.addSuppression(db, {
      tenantId: payload.tenantId,
      email: payload.email,
      reason: 'unsubscribe',
      scope: 'individual',
      source: 'user_action',
      metadata: { unsubscribedVia: 'one_click_token' }
    });

    return updated;
  }

  generateUnsubscribeToken(tenantId: string, email: string): string {
    // Expires in 30 days
    const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return signEmailActionToken({
      purpose: 'unsubscribe',
      tenantId,
      subscriberId: 'preference-token',
      email,
      exp
    });
  }
}

export const preferencesService = new PreferencesService();
