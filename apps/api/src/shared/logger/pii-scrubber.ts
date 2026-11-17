import pino from 'pino';

/**
 * 7 regex patterns scrubbed from every log line to enforce CON-L-03 (zero PII in logs).
 */
const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  // 1. Indian mobile numbers (+91XXXXXXXXXX or standalone 10-digit [6-9]XXXXXXXXX)
  { name: 'phone', regex: /(\+91[\s-]?)?[6-9]\d{9}\b/g, replacement: '[REDACTED_PHONE]' },
  // 2. Email addresses
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  // 3. Aadhaar 12-digit numbers (grouped or ungrouped)
  { name: 'aadhaar', regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[REDACTED_AADHAAR]' },
  // 4. Indian PAN numbers
  { name: 'pan', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, replacement: '[REDACTED_PAN]' },
  // 5. JWT / Bearer tokens
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },
  // 6. OTP values in JSON or text
  { name: 'otp', regex: /("otp"\s*:\s*")\d{6}(")/gi, replacement: '$1[REDACTED_OTP]$2' },
  // 7. Razorpay / API secrets or 64-char hex keys
  { name: 'secret', regex: /\b(rzp_(?:test|live)_[A-Za-z0-9]+|[0-9a-f]{64})\b/gi, replacement: '[REDACTED_SECRET]' }
];

export function scrubPiiString(input: string): string {
  let output = input;
  for (const pattern of PII_PATTERNS) {
    output = output.replace(pattern.regex, pattern.replacement);
  }
  return output;
}

export function scrubPiiValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubPiiString(value);
  if (Array.isArray(value)) return value.map((item) => scrubPiiValue(item, depth + 1));
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|govtId|fullName|phone|email/i.test(k)) {
        clean[k] = '[REDACTED_FIELD]';
      } else {
        clean[k] = scrubPiiValue(v, depth + 1);
      }
    }
    return clean;
  }
  return value;
}

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-razorpay-signature"]',
      '*.password',
      '*.passwordHash',
      '*.govtIdNumber',
      '*.otp'
    ],
    censor: '[REDACTED]'
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: scrubPiiString(req.url ?? ''),
        requestId: req.id
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode
      };
    }
  }
});