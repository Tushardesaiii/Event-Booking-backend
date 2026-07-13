export interface EmailDispatchResult {
  providerMessageId?: string;
  status: string;
  responseRaw?: string;
}

export interface SmsDispatchResult {
  providerMessageId?: string;
  status: string;
  responseRaw?: string;
}

export interface EmailDispatchInput {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  fromEmail?: string;
  fromName?: string;
  metadata?: Record<string, any>;
}

export interface SmsDispatchInput {
  phoneNumber: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface EmailDispatcher {
  dispatch(input: EmailDispatchInput): Promise<EmailDispatchResult>;
}

export interface SmsDispatcher {
  dispatch(input: SmsDispatchInput): Promise<SmsDispatchResult>;
}

export interface NotificationDispatcher {
  sendEmail(input: EmailDispatchInput): Promise<EmailDispatchResult & { provider: string }>;
  sendOtp(input: SmsDispatchInput): Promise<SmsDispatchResult & { provider: string }>;
}
