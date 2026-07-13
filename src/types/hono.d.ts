import type { AppContextVariables } from './context.js';

declare module 'hono' {
  interface ContextVariableMap extends AppContextVariables {}
}

export {};
