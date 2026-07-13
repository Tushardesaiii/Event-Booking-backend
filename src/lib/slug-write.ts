import { isUniqueViolation } from './database-errors.js';

export async function insertWithSlugRetry<T>(createRecord: (slug: string) => Promise<T | null>, buildSlug: () => string) {
  const firstSlug = buildSlug();

  try {
    return await createRecord(firstSlug);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const secondSlug = buildSlug();
  return createRecord(secondSlug);
}