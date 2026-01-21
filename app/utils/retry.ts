export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  initialDelayMs: number,
  identifier: string
): Promise<T> {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      console.error(`Attempt ${retries + 1} failed for ${identifier}:`, error.message);
      retries++;
      if (retries < maxRetries) {
        const delay = Math.min(initialDelayMs * Math.pow(2, retries), 120000); // Exponential backoff, max 2 minutes
        const jitter = Math.random() * delay * 0.2; // Add 20% jitter
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      } else {
        throw error; // Re-throw if max retries reached
      }
    }
  }
  throw new Error("Max retries reached"); // Should not be reached
}
