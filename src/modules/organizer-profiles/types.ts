import type { InferSelectModel } from 'drizzle-orm';
import type {
  organizers,
  organizerSocialLinks,
  organizerReviews,
  organizerLikes,
  organizerSafetyProfiles,
  organizerVerifications,
  sosAlerts
} from './schema.js';
import type {
  CreateOrganizerInput,
  UpdateOrganizerInput,
  OrganizerListQueryInput,
  OrganizerSlugParamsInput,
  CreateOrganizerReviewInput,
  UpdateOrganizerReviewInput,
  OrganizerVerificationRequestInput,
  OrganizerVerificationDecisionInput,
  OrganizerSafetyProfileInput,
  SosReportIssueInput,
  SosEmergencyAlertInput
} from './validation.js';

export type OrganizerRecord = InferSelectModel<typeof organizers>;
export type OrganizerSocialLinkRecord = InferSelectModel<typeof organizerSocialLinks>;
export type OrganizerReviewRecord = InferSelectModel<typeof organizerReviews>;
export type OrganizerLikeRecord = InferSelectModel<typeof organizerLikes>;
export type OrganizerSafetyProfileRecord = InferSelectModel<typeof organizerSafetyProfiles>;
export type OrganizerVerificationRecord = InferSelectModel<typeof organizerVerifications>;
export type SosAlertRecord = InferSelectModel<typeof sosAlerts>;

export type OrganizerListItem = OrganizerRecord & {
  socialLinks?: OrganizerSocialLinkRecord[];
};

export type OrganizerDetailItem = OrganizerRecord & {
  socialLinks: OrganizerSocialLinkRecord[];
  reviewStats?: {
    averageRating: number;
    totalReviews: number;
  };
};

export type OrganizerListQuery = OrganizerListQueryInput;
export type OrganizerSlugParams = OrganizerSlugParamsInput;
export type CreateOrganizerDTO = CreateOrganizerInput;
export type UpdateOrganizerDTO = UpdateOrganizerInput;
export type CreateOrganizerReviewDTO = CreateOrganizerReviewInput;
export type UpdateOrganizerReviewDTO = UpdateOrganizerReviewInput;
export type OrganizerVerificationRequestDTO = OrganizerVerificationRequestInput;
export type OrganizerVerificationDecisionDTO = OrganizerVerificationDecisionInput;
export type OrganizerSafetyProfileDTO = OrganizerSafetyProfileInput;
export type SosReportIssueDTO = SosReportIssueInput;
export type SosEmergencyAlertDTO = SosEmergencyAlertInput;
