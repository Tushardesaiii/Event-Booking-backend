import type { Context } from 'hono';

import { successResponse } from '../../lib/response.js';
import type { AppEnv } from '../../types/context.js';
import { generateChatReply } from './service.js';
import type { AiChatRequestInput } from './types.js';

export const aiChatController = {
  async chat(c: Context<AppEnv>) {
    const user = c.get('user');
    const { message, history } = c.get('validatedBody') as AiChatRequestInput;

    const result = await generateChatReply({
      message,
      history,
      userName: user?.fullName ?? null
    });

    return successResponse(c, result, 'Reply generated successfully');
  }
};
