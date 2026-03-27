import { setTimeout } from 'timers/promises';

/**
 * Utility class for handling operation timeouts
 */
export class TimeoutUtil {
  /**
   * Execute a promise with a timeout
   * @param operation - The operation to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param errorMessage - Custom error message
   * @returns Promise that resolves with the operation result or rejects on timeout
   */
  static async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    errorMessage?: string
  ): Promise<T> {
    const timeoutPromise = setTimeout(timeoutMs).then(() => {
      throw new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`);
    });

    return Promise.race([operation, timeoutPromise]);
  }

  /**
   * Execute multiple operations with individual timeouts
   * @param operations - Array of operations with their timeouts
   * @returns Promise that resolves when all operations complete
   */
  static async withTimeouts<T>(
    operations: Array<{ operation: Promise<T>; timeoutMs: number; errorMessage?: string }>
  ): Promise<T[]> {
    const timeoutOperations = operations.map(({ operation, timeoutMs, errorMessage }) =>
      this.withTimeout(operation, timeoutMs, errorMessage)
    );

    return Promise.all(timeoutOperations);
  }

  /**
   * Create a timeout controller for abortable operations
   * @param timeoutMs - Timeout in milliseconds
   * @returns AbortController and timeout promise
   */
  static createTimeoutController(timeoutMs: number): {
    controller: AbortController;
    timeoutPromise: Promise<void>;
  } {
    const controller = new AbortController();
    const timeoutPromise = setTimeout(timeoutMs).then(() => {
      controller.abort();
    });

    return { controller, timeoutPromise };
  }
}
