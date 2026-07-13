const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

export function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error('phone number is required');
  }

  const compact = trimmed.replace(/[\s().-]+/g, '');

  let normalized = compact;

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }

  if (!normalized.startsWith('+')) {
    throw new Error('phone number must include a country code');
  }

  if (!/^\+[0-9]+$/.test(normalized)) {
    throw new Error('phone number may only contain digits and a leading plus');
  }

  if (!E164_PHONE_REGEX.test(normalized)) {
    throw new Error('phone number must be a valid E.164 number');
  }

  return normalized;
}

export function isValidE164PhoneNumber(value: string) {
  try {
    normalizePhoneNumber(value);
    return true;
  } catch {
    return false;
  }
}