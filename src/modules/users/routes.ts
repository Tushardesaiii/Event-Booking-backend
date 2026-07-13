import { Hono } from 'hono';

import type { AppEnv } from '../../types/context.js';

export const usersRoutes = new Hono<AppEnv>();
