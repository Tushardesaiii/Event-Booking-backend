// src/modules/profile/services/activityService.ts
import { db } from '../../../db/client.js';
import { profileActivity } from '../../../db/schema/profile.js';
import { eq, and, desc, lt } from 'drizzle-orm';

export class ActivityService {
  async logActivity(tenantId: string, profileId: string, activityType: string, targetId?: string, metadata: any = {}) {
    await db.insert(profileActivity).values({
      tenantId,
      profileId,
      activityType,
      targetId,
      metadata,
      createdAt: new Date()
    });
  }

  async getActivities(tenantId: string, profileId: string, limit = 20, cursor?: string) {
    let conditions = [
      eq(profileActivity.tenantId, tenantId),
      eq(profileActivity.profileId, profileId)
    ];

    if (cursor) {
      const cursorDate = new Date(Number(cursor));
      conditions.push(lt(profileActivity.createdAt, cursorDate));
    }

    return db
      .select()
      .from(profileActivity)
      .where(and(...conditions))
      .orderBy(desc(profileActivity.createdAt))
      .limit(limit);
  }
}

export const activityService = new ActivityService();
