import { describe, expect, it } from "@jest/globals";
import { BoundedSemaphore } from "../nats";

/**
 * The sync worker's JetStream consumer uses a bounded FIFO semaphore to keep
 * its in-flight handler buffer flat (#1848). These tests pin the bounding and
 * FIFO behavior so the buffer can never grow with the message rate.
 */
describe("BoundedSemaphore (#1848)", () => {
  it("allows up to capacity acquisitions without blocking", async () => {
    const semaphore = new BoundedSemaphore(2);

    await semaphore.acquire();
    await semaphore.acquire();

    expect(semaphore.inFlight).toBe(2);
    expect(semaphore.pending).toBe(0);
  });

  it("queues acquisitions beyond capacity", async () => {
    const semaphore = new BoundedSemaphore(1);
    await semaphore.acquire();

    const second = semaphore.acquire();
    expect(semaphore.pending).toBe(1);

    semaphore.release();
    await second;
    expect(semaphore.inFlight).toBe(1);
    expect(semaphore.pending).toBe(0);
  });

  it("bounds in-flight handlers to the configured capacity", async () => {
    const capacity = 3;
    const semaphore = new BoundedSemaphore(capacity);
    const running = new Set<number>();

    const tasks = Array.from({ length: 20 }, async (_, i) => {
      await semaphore.acquire();
      running.add(i);
      expect(running.size).toBeLessThanOrEqual(capacity);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running.delete(i);
      semaphore.release();
    });

    await Promise.all(tasks);
    expect(semaphore.inFlight).toBe(0);
    expect(semaphore.pending).toBe(0);
  });

  it("releases waiters in FIFO order", async () => {
    const semaphore = new BoundedSemaphore(1);
    await semaphore.acquire();

    const order: number[] = [];
    const first = semaphore.acquire().then(() => order.push(1));
    const second = semaphore.acquire().then(() => order.push(2));
    const third = semaphore.acquire().then(() => order.push(3));

    semaphore.release();
    await first;
    semaphore.release();
    await second;
    semaphore.release();
    await third;

    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new BoundedSemaphore(0)).toThrow();
    expect(() => new BoundedSemaphore(-1)).toThrow();
  });
});
