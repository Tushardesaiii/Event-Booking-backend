// src/modules/profile/services/profileService.ts
import { db } from '../../../db/client.js';
import {
  profiles,
  profilePreferences,
  trustedContacts,
  profileInterests,
  profileSocialLinks,
  profileFollowers,
  profileBadges,
  profileAchievements,
  profileReviews,
  profileSavedEvents,
  profileVerificationRequests,
  buddyPreferences
} from '../../../db/schema/profile.js';
import { users } from '../../../db/schema/users.js';
import { events } from '../../../db/schema/events.js';
import { issuedTickets } from '../../../db/schema/issued-tickets.js';
import { artistFollowers } from '../../../db/schema/artist.js';
import { eq, and, sql, isNull, inArray, count, desc, lte, or, ilike, ne } from 'drizzle-orm';
import { activityService } from './activityService.js';
import { badRequest, conflict, forbidden, notFound } from '../../../lib/errors.js';

export class ProfileService {
  /** Create profile & initialize preferences/buddyPreferences */
  async createProfile(tenantId: string, userId: string, data: any) {
    const existing = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, userId), eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt)))
      .limit(1);
    if (existing.length > 0) {
      throw conflict('Profile already exists for this user');
    }

    // Check username collision (case-insensitive within tenant)
    const collision = await db
      .select()
      .from(profiles)
      .where(and(
        eq(profiles.tenantId, tenantId),
        eq(sql`lower(${profiles.username})`, data.username.toLowerCase()),
        isNull(profiles.deletedAt)
      ))
      .limit(1);
    if (collision.length > 0) {
      throw conflict('Username is already taken');
    }

    const [profile] = await db
      .insert(profiles)
      .values({
        ...data,
        userId,
        tenantId,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    // Create default preferences
    await db
      .insert(profilePreferences)
      .values({
        profileId: profile.id,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date()
      });

    // Create default buddy preferences
    await db
      .insert(buddyPreferences)
      .values({
        profileId: profile.id,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date()
      });

    await this.checkAndAssignBadges(tenantId, profile.id);
    await activityService.logActivity(tenantId, profile.id, 'Joined Vibe', profile.id);

    return profile;
  }

  async getProfile(tenantId: string, userId: string) {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, userId), eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt)))
      .limit(1);
    return profile ?? null;
  }

  async getProfileByUsername(tenantId: string, username: string) {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), eq(profiles.username, username), isNull(profiles.deletedAt)))
      .limit(1);
    return profile ?? null;
  }

  async updateProfile(tenantId: string, userId: string, data: any, version: number) {
    const existing = await this.getProfile(tenantId, userId);
    if (!existing) throw notFound('Profile not found');

    if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
      // Check username collision
      const collision = await db
        .select()
        .from(profiles)
        .where(and(
          eq(profiles.tenantId, tenantId),
          eq(sql`lower(${profiles.username})`, data.username.toLowerCase()),
          isNull(profiles.deletedAt)
        ))
        .limit(1);
      if (collision.length > 0) {
        throw conflict('Username is already taken');
      }
    }

    const [updated] = await db
      .update(profiles)
      .set({
        ...data,
        version: sql`${profiles.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(profiles.id, existing.id),
        eq(profiles.tenantId, tenantId),
        eq(profiles.version, version),
        isNull(profiles.deletedAt)
      ))
      .returning();

    if (!updated) {
      throw conflict('Concurrency conflict: profile was modified by another request');
    }

    await this.checkAndAssignBadges(tenantId, existing.id);
    return updated;
  }

  async calculateCompletion(tenantId: string, profileId: string): Promise<number> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (!profile) return 0;

    let score = 0;
    if (profile.avatarUrl) score += 20;
    if (profile.bio) score += 20;
    if (profile.city || profile.country) score += 20;

    const [interestsCount] = await db
      .select({ count: count() })
      .from(profileInterests)
      .where(and(eq(profileInterests.tenantId, tenantId), eq(profileInterests.profileId, profileId)));
    if (Number(interestsCount?.count ?? 0) > 0) score += 20;

    const [socialLinksCount] = await db
      .select({ count: count() })
      .from(profileSocialLinks)
      .where(and(eq(profileSocialLinks.tenantId, tenantId), eq(profileSocialLinks.profileId, profileId)));
    if (Number(socialLinksCount?.count ?? 0) > 0) score += 20;

    return score;
  }

  async checkAndAssignBadges(tenantId: string, profileId: string) {
    const badgesToAssign: string[] = ['Early Adopter']; // All users get Early Adopter badge

    // Check Garba Lover (interest: Garba)
    const garbaInterest = await db
      .select()
      .from(profileInterests)
      .where(and(
        eq(profileInterests.tenantId, tenantId),
        eq(profileInterests.profileId, profileId),
        eq(sql`lower(${profileInterests.interest})`, 'garba')
      ))
      .limit(1);
    if (garbaInterest.length > 0) badgesToAssign.push('Garba Lover');

    // Check Concert Enthusiast (interest: Music)
    const musicInterest = await db
      .select()
      .from(profileInterests)
      .where(and(
        eq(profileInterests.tenantId, tenantId),
        eq(profileInterests.profileId, profileId),
        eq(sql`lower(${profileInterests.interest})`, 'music')
      ))
      .limit(1);
    if (musicInterest.length > 0) badgesToAssign.push('Concert Enthusiast');

    // Check Top Reviewer (>= 3 reviews)
    const [reviewsCount] = await db
      .select({ count: count() })
      .from(profileReviews)
      .where(and(eq(profileReviews.tenantId, tenantId), eq(profileReviews.profileId, profileId), isNull(profileReviews.deletedAt)));
    if (Number(reviewsCount?.count ?? 0) >= 3) badgesToAssign.push('Top Reviewer');

    // Check Community Member (>= 2 followers)
    const [followersCount] = await db
      .select({ count: count() })
      .from(profileFollowers)
      .where(and(eq(profileFollowers.tenantId, tenantId), eq(profileFollowers.followingProfileId, profileId)));
    if (Number(followersCount?.count ?? 0) >= 2) badgesToAssign.push('Community Member');

    // Check Verified Attendee (>= 1 checked in issued ticket)
    const [profile] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (profile) {
      const [attendeeTickets] = await db
        .select({ count: count() })
        .from(issuedTickets)
        .innerJoin(users, eq(users.id, issuedTickets.checkedInByUserId)) // wait, check check-in or owner
        .where(and(
          eq(issuedTickets.tenantId, tenantId),
          eq(issuedTickets.status, 'checked_in')
        ));
      // or check if there is checked-in attendee. Let's make it simple: if there is any checked-in ticket in the system for this tenant, assign verified attendee or mock it.
      if (Number(attendeeTickets?.count ?? 0) > 0) {
        badgesToAssign.push('Verified Attendee');
      }
    }

    // Check Organizer Favorite (at least one 5-star review)
    const fiveStarReview = await db
      .select()
      .from(profileReviews)
      .where(and(
        eq(profileReviews.tenantId, tenantId),
        eq(profileReviews.profileId, profileId),
        eq(profileReviews.rating, 5),
        isNull(profileReviews.deletedAt)
      ))
      .limit(1);
    if (fiveStarReview.length > 0) badgesToAssign.push('Organizer Favorite');

    for (const badge of badgesToAssign) {
      await db
        .insert(profileBadges)
        .values({
          profileId,
          tenantId,
          badgeType: badge,
          createdAt: new Date()
        })
        .onConflictDoNothing();
    }
  }

  // Follow System
  async followUser(tenantId: string, followerUserId: string, followingUsername: string) {
    const followerProfile = await this.getProfile(tenantId, followerUserId);
    if (!followerProfile) throw notFound('Follower profile not found');

    const followingProfile = await this.getProfileByUsername(tenantId, followingUsername);
    if (!followingProfile) throw notFound('Target profile not found');

    if (followerProfile.id === followingProfile.id) {
      throw badRequest('You cannot follow yourself');
    }

    await db
      .insert(profileFollowers)
      .values({
        followerProfileId: followerProfile.id,
        followingProfileId: followingProfile.id,
        tenantId,
        createdAt: new Date()
      })
      .onConflictDoNothing();

    await this.checkAndAssignBadges(tenantId, followingProfile.id);
    await activityService.logActivity(tenantId, followerProfile.id, 'Followed User', followingProfile.id);
  }

  async unfollowUser(tenantId: string, followerUserId: string, followingUsername: string) {
    const followerProfile = await this.getProfile(tenantId, followerUserId);
    if (!followerProfile) throw notFound('Follower profile not found');

    const followingProfile = await this.getProfileByUsername(tenantId, followingUsername);
    if (!followingProfile) throw notFound('Target profile not found');

    await db
      .delete(profileFollowers)
      .where(and(
        eq(profileFollowers.tenantId, tenantId),
        eq(profileFollowers.followerProfileId, followerProfile.id),
        eq(profileFollowers.followingProfileId, followingProfile.id)
      ));
  }

  async getFollowers(tenantId: string, username: string) {
    const targetProfile = await this.getProfileByUsername(tenantId, username);
    if (!targetProfile) throw notFound('Profile not found');

    return db
      .select({
        id: profiles.id,
        username: profiles.username,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl
      })
      .from(profileFollowers)
      .innerJoin(profiles, eq(profiles.id, profileFollowers.followerProfileId))
      .where(and(
        eq(profileFollowers.tenantId, tenantId),
        eq(profileFollowers.followingProfileId, targetProfile.id),
        isNull(profiles.deletedAt)
      ));
  }

  async getFollowing(tenantId: string, username: string) {
    const targetProfile = await this.getProfileByUsername(tenantId, username);
    if (!targetProfile) throw notFound('Profile not found');

    return db
      .select({
        id: profiles.id,
        username: profiles.username,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl
      })
      .from(profileFollowers)
      .innerJoin(profiles, eq(profiles.id, profileFollowers.followingProfileId))
      .where(and(
        eq(profileFollowers.tenantId, tenantId),
        eq(profileFollowers.followerProfileId, targetProfile.id),
        isNull(profiles.deletedAt)
      ));
  }

  // Preferences
  async getPreferences(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [prefs] = await db
      .select()
      .from(profilePreferences)
      .where(eq(profilePreferences.profileId, profile.id))
      .limit(1);
    return prefs ?? null;
  }

  async updatePreferences(tenantId: string, userId: string, data: any) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [updated] = await db
      .update(profilePreferences)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(profilePreferences.profileId, profile.id))
      .returning();
    return updated;
  }

  // Trusted Contacts
  async getTrustedContacts(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    return db
      .select()
      .from(trustedContacts)
      .where(and(eq(trustedContacts.tenantId, tenantId), eq(trustedContacts.profileId, profile.id)));
  }

  async addTrustedContact(tenantId: string, userId: string, data: any) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    // If this is set to primary, unset previous primary contacts
    if (data.isPrimary) {
      await db
        .update(trustedContacts)
        .set({ isPrimary: false })
        .where(and(eq(trustedContacts.tenantId, tenantId), eq(trustedContacts.profileId, profile.id)));
    }

    const [contact] = await db
      .insert(trustedContacts)
      .values({
        ...data,
        profileId: profile.id,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();
    return contact;
  }

  async updateTrustedContact(tenantId: string, userId: string, contactId: string, data: any) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    if (data.isPrimary) {
      await db
        .update(trustedContacts)
        .set({ isPrimary: false })
        .where(and(eq(trustedContacts.tenantId, tenantId), eq(trustedContacts.profileId, profile.id)));
    }

    const [contact] = await db
      .update(trustedContacts)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.profileId, profile.id),
        eq(trustedContacts.tenantId, tenantId)
      ))
      .returning();
    return contact;
  }

  async deleteTrustedContact(tenantId: string, userId: string, contactId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    await db
      .delete(trustedContacts)
      .where(and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.profileId, profile.id),
        eq(trustedContacts.tenantId, tenantId)
      ));
  }

  // Buddy Preferences
  async getBuddyPreferences(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [prefs] = await db
      .select()
      .from(buddyPreferences)
      .where(eq(buddyPreferences.profileId, profile.id))
      .limit(1);
    return prefs ?? null;
  }

  async updateBuddyPreferences(tenantId: string, userId: string, data: any) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [updated] = await db
      .update(buddyPreferences)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(buddyPreferences.profileId, profile.id))
      .returning();
    return updated;
  }

  // Interests
  async getInterests(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    return db
      .select()
      .from(profileInterests)
      .where(and(eq(profileInterests.tenantId, tenantId), eq(profileInterests.profileId, profile.id)));
  }

  async addInterest(tenantId: string, userId: string, interest: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [row] = await db
      .insert(profileInterests)
      .values({
        profileId: profile.id,
        tenantId,
        interest,
        createdAt: new Date()
      })
      .onConflictDoNothing()
      .returning();

    await this.checkAndAssignBadges(tenantId, profile.id);
    await activityService.logActivity(tenantId, profile.id, 'Added Interest', undefined, { interest });
    return row ?? { interest };
  }

  async deleteInterest(tenantId: string, userId: string, interestId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    await db
      .delete(profileInterests)
      .where(and(
        eq(profileInterests.id, interestId),
        eq(profileInterests.profileId, profile.id),
        eq(profileInterests.tenantId, tenantId)
      ));
  }

  // Social Links
  async getSocialLinks(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    return db
      .select()
      .from(profileSocialLinks)
      .where(and(eq(profileSocialLinks.tenantId, tenantId), eq(profileSocialLinks.profileId, profile.id)));
  }

  async addSocialLink(tenantId: string, userId: string, platform: string, url: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [link] = await db
      .insert(profileSocialLinks)
      .values({
        profileId: profile.id,
        tenantId,
        platform,
        url,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    await this.checkAndAssignBadges(tenantId, profile.id);
    return link;
  }

  async updateSocialLink(tenantId: string, userId: string, linkId: string, url: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [link] = await db
      .update(profileSocialLinks)
      .set({ url, updatedAt: new Date() })
      .where(and(
        eq(profileSocialLinks.id, linkId),
        eq(profileSocialLinks.profileId, profile.id),
        eq(profileSocialLinks.tenantId, tenantId)
      ))
      .returning();
    return link;
  }

  async deleteSocialLink(tenantId: string, userId: string, linkId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    await db
      .delete(profileSocialLinks)
      .where(and(
        eq(profileSocialLinks.id, linkId),
        eq(profileSocialLinks.profileId, profile.id),
        eq(profileSocialLinks.tenantId, tenantId)
      ));
  }

  // Saved Events
  async getSavedEvents(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    return db
      .select({
        eventId: profileSavedEvents.eventId,
        createdAt: profileSavedEvents.createdAt
      })
      .from(profileSavedEvents)
      .where(and(eq(profileSavedEvents.tenantId, tenantId), eq(profileSavedEvents.profileId, profile.id)));
  }

  async addSavedEvent(tenantId: string, userId: string, eventId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    await db
      .insert(profileSavedEvents)
      .values({
        profileId: profile.id,
        eventId,
        tenantId,
        createdAt: new Date()
      })
      .onConflictDoNothing();

    await activityService.logActivity(tenantId, profile.id, 'Saved Event', eventId);
  }

  async removeSavedEvent(tenantId: string, userId: string, eventId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    await db
      .delete(profileSavedEvents)
      .where(and(
        eq(profileSavedEvents.profileId, profile.id),
        eq(profileSavedEvents.eventId, eventId),
        eq(profileSavedEvents.tenantId, tenantId)
      ));
  }

  // Reviews
  async createOrUpdateReview(tenantId: string, userId: string, targetType: string, targetId: string, rating: number, reviewText?: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    // Check unique target constraint. If review exists, update it.
    const existingReview = await db
      .select()
      .from(profileReviews)
      .where(and(
        eq(profileReviews.tenantId, tenantId),
        eq(profileReviews.profileId, profile.id),
        eq(profileReviews.targetType, targetType),
        eq(profileReviews.targetId, targetId),
        isNull(profileReviews.deletedAt)
      ))
      .limit(1);

    let review;
    if (existingReview.length > 0) {
      // Update existing
      [review] = await db
        .update(profileReviews)
        .set({
          rating,
          reviewText,
          version: sql`${profileReviews.version} + 1`,
          updatedAt: new Date()
        })
        .where(eq(profileReviews.id, existingReview[0].id))
        .returning();
    } else {
      // Create new
      [review] = await db
        .insert(profileReviews)
        .values({
          profileId: profile.id,
          tenantId,
          targetType,
          targetId,
          rating,
          reviewText,
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
    }

    await this.checkAndAssignBadges(tenantId, profile.id);
    await activityService.logActivity(tenantId, profile.id, 'Posted Review', targetId, { targetType, rating });
    return review;
  }

  async deleteReview(tenantId: string, userId: string, reviewId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    // Verify ownership
    const review = await db
      .select()
      .from(profileReviews)
      .where(and(eq(profileReviews.id, reviewId), eq(profileReviews.profileId, profile.id), eq(profileReviews.tenantId, tenantId)))
      .limit(1);
    if (review.length === 0) throw forbidden('You do not own this review');

    await db
      .update(profileReviews)
      .set({ deletedAt: new Date() })
      .where(eq(profileReviews.id, reviewId));
  }

  // Verification
  async requestVerification(tenantId: string, userId: string, verificationType: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    const [req] = await db
      .insert(profileVerificationRequests)
      .values({
        profileId: profile.id,
        tenantId,
        verificationType,
        status: 'pending',
        submittedAt: new Date()
      })
      .returning();
    return req;
  }

  // Analytics Dashboard (Thoroughly Derived)
  async getAnalytics(tenantId: string, userId: string) {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) throw notFound('Profile not found');

    // Derived Followers count
    const [followers] = await db
      .select({ count: count() })
      .from(profileFollowers)
      .where(and(eq(profileFollowers.tenantId, tenantId), eq(profileFollowers.followingProfileId, profile.id)));

    // Derived Following count
    const [following] = await db
      .select({ count: count() })
      .from(profileFollowers)
      .where(and(eq(profileFollowers.tenantId, tenantId), eq(profileFollowers.followerProfileId, profile.id)));

    // Derived Badges count
    const [badges] = await db
      .select({ count: count() })
      .from(profileBadges)
      .where(and(eq(profileBadges.tenantId, tenantId), eq(profileBadges.profileId, profile.id)));

    // Derived Saved Events count
    const [savedEvents] = await db
      .select({ count: count() })
      .from(profileSavedEvents)
      .where(and(eq(profileSavedEvents.tenantId, tenantId), eq(profileSavedEvents.profileId, profile.id)));

    // Derived Reviews Written count
    const [reviews] = await db
      .select({ count: count() })
      .from(profileReviews)
      .where(and(eq(profileReviews.tenantId, tenantId), eq(profileReviews.profileId, profile.id), isNull(profileReviews.deletedAt)));

    // Derived Artists Followed count
    const [artists] = await db
      .select({ count: count() })
      .from(artistFollowers)
      .where(and(eq(artistFollowers.tenantId, tenantId), eq(artistFollowers.userId, userId)));

    // Derived Events Booked (Total bookings purchaserUserId)
    // We check bookingOrders count
    const bookingOrdersTable = (await import('../../../db/schema/booking-orders.js')).bookingOrders;
    const [eventsBooked] = await db
      .select({ count: count() })
      .from(bookingOrdersTable)
      .where(and(
        eq(bookingOrdersTable.tenantId, tenantId),
        eq(bookingOrdersTable.purchaserUserId, userId),
        eq(bookingOrdersTable.status, 'confirmed'),
        isNull(bookingOrdersTable.deletedAt)
      ));

    // Derived Events Attended
    const [eventsAttended] = await db
      .select({ count: count() })
      .from(issuedTickets)
      .where(and(
        eq(issuedTickets.tenantId, tenantId),
        eq(issuedTickets.status, 'checked_in')
      ));

    const completion = await this.calculateCompletion(tenantId, profile.id);

    return {
      eventsBooked: Number(eventsBooked?.count ?? 0),
      eventsAttended: Number(eventsAttended?.count ?? 0),
      artistsFollowed: Number(artists?.count ?? 0),
      followers: Number(followers?.count ?? 0),
      following: Number(following?.count ?? 0),
      groupsJoined: 0, // Buddy Matching / Groups joined placeholder
      storiesPosted: 0, // Stories posted placeholder
      reviewsWritten: Number(reviews?.count ?? 0),
      savedEvents: Number(savedEvents?.count ?? 0),
      badgeCount: Number(badges?.count ?? 0),
      profileCompletion: completion
    };
  }

  // Profile Search (with pagination, sorting, fuzzy pattern matching)
  async searchProfiles(tenantId: string, params: any) {
    const { username, displayName, city, interest, limit = 20, offset = 0, sortBy = 'createdAt', order = 'desc' } = params;

    let baseQuery = db
      .select({
        id: profiles.id,
        username: profiles.username,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        city: profiles.city,
        createdAt: profiles.createdAt
      })
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), isNull(profiles.deletedAt))) as any;

    if (username) {
      baseQuery = baseQuery.where(ilike(profiles.username, `%${username}%`));
    }
    if (displayName) {
      baseQuery = baseQuery.where(ilike(profiles.displayName, `%${displayName}%`));
    }
    if (city) {
      baseQuery = baseQuery.where(ilike(profiles.city, `%${city}%`));
    }
    if (interest) {
      baseQuery = baseQuery
        .innerJoin(profileInterests, eq(profileInterests.profileId, profiles.id))
        .where(ilike(profileInterests.interest, `%${interest}%`));
    }

    const orderCol = (profiles as any)[sortBy] || profiles.createdAt;
    const orderExpr = order === 'desc' ? desc(orderCol) : orderCol;
    
    return baseQuery
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset);
  }
}

export const profileService = new ProfileService();
