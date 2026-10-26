const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries fn with exponential backoff and full jitter.
 * shouldRetry(error, attempt) decides whether a failure is transient.
 */
export const withRetry = async (fn, {
  retries = 3,
  baseDelayMs = 500,
  maxDelayMs = 5000,
  shouldRetry = () => true,
  onRetry = () => {},
  delay = sleep,
} = {}) => {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const wait = Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      onRetry(error, attempt, wait);
      attempt += 1;
      await delay(wait);
    }
  }
};

/** Errors where the request never reached the server, so repeating it is always safe. */
export const isConnectionError = error =>
  !error.response && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE'].includes(error.code);

/** Timeouts are ambiguous: the server may have acted on the request. */
export const isTimeout = error => !error.response && ['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code);

export const isRetryableStatus = error => {
  const status = error.response?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
};
