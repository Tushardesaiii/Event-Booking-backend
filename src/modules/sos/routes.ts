import { Hono } from 'hono';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { tenantMiddleware } from '../../middlewares/tenant.middleware.js';
import { validateBody } from '../../middlewares/validation.middleware.js';
import { requirePermission } from '../../middlewares/rbac.middleware.js';
import type { AppEnv } from '../../types/context.js';
import { sosController } from './controller.js';
import {
  sosReportIssueSchema,
  sosEmergencyAlertSchema,
  sosStatusUpdateSchema
} from '../organizer-profiles/validation.js';

export const sosRoutes = new Hono<AppEnv>();

sosRoutes.use('*', authMiddleware);
sosRoutes.use('*', tenantMiddleware({ routeParamNames: [] }));

sosRoutes.get('/event/:eventSlug', sosController.getEventSafety);
sosRoutes.get('/organizer/:organizerSlug', sosController.getOrganizerSafety);
sosRoutes.post('/report-issue', validateBody(sosReportIssueSchema), sosController.reportIssue);
sosRoutes.post('/emergency-alert', validateBody(sosEmergencyAlertSchema), sosController.triggerEmergency);

// Dashboard SOS console (organizer staff/management).
sosRoutes.get('/alerts', requirePermission(['event.manage']), sosController.listAlerts);
sosRoutes.patch('/alerts/:id/status', requirePermission(['event.manage']), validateBody(sosStatusUpdateSchema), sosController.updateAlertStatus);
