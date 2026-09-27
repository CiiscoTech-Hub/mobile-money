import logger from "../utils/logger";
import {
  connect,
  StringCodec,
  consumerOpts,
  type NatsConnection,
  type JsMsg,
} from "nats";

const NATS_URL = process.env.NATS_URL || "nats://localhost:4222";

export const NATS_QUEUE_ENABLED = process.env.NATS_QUEUE_ENABLED === "true";
export const NATS_SUBJECT = process.env.NATS_SUBJECT || "callbacks.ingest";
export const NATS_DURABLE_CONSUMER =
  process.env.NATS_DURABLE_CONSUMER || "transaction-processing-consumer";
export const NATS_CONSUMER_GROUP =
  process.env.NATS_CONSUMER_GROUP || "transaction-processing-group";
export const NATS_ACK_WAIT_MS = Math.max(
  1000,
  parseInt(process.env.NATS_ACK_WAIT_MS || "30000", 10),
);

/**
 * A fixed-capacity FIFO semaphore that bounds the number of in-flight
 * message handlers to `capacity`.
 *
 * This replaces the previous `Set<Promise>` + `Promise.race` draining loop:
 *
 *  - Memory is strictly bounded — at most `capacity` handler promises are
 *    ever in flight, so the consumer's queue buffer can never grow with the
 *    message rate.
 *  - Scheduling is O(1) acquire/release instead of an O(n) scan of the
 *    in-flight set on every message (which is O(n²) under sustained load).
 *  - Handoffs are FIFO, so no message is starved by newer arrivals.
 */
export class BoundedSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Semaphore capacity must be a positive integer");
    }
  }

  acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the freed slot directly to the longest-waiting consumer.
      next();
    } else {
      this.active -= 1;
    }
  }

  get pending(): number {
    return this.waiters.length;
  }

  get inFlight(): number {
    return this.active;
  }
}

class NatsManager {
  private connection: NatsConnection | null = null;
  private sc = StringCodec();

  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    this.connection = await connect({ servers: NATS_URL });
    console.log("[NATS] connected to", NATS_URL);
  }

  async consume<T>(
    subject: string,
    durable: string,
    queueGroup: string,
    onMessage: (data: T, msg: JsMsg) => Promise<void>,
    concurrency: number = 5,
  ): Promise<void> {
    await this.connect();

    if (!this.connection) {
      throw new Error("NATS connection did not initialize");
    }

    const js = this.connection.jetstream();
    const opts = consumerOpts();
    opts.durable(durable);
    opts.queue(queueGroup);
    opts.manualAck();
    opts.maxAckPending(concurrency * 2);
    opts.ackWait(NATS_ACK_WAIT_MS);
    const subscription = await js.subscribe(subject, opts);

    // Bounded in-flight buffer: at most `concurrency` handlers are processed
    // at once, keeping the consumer's memory layout flat regardless of how
    // fast messages arrive from JetStream.
    const semaphore = new BoundedSemaphore(concurrency);
    const inFlight = new Set<Promise<void>>();

    for await (const msg of subscription) {
      await semaphore.acquire();

      const handler = (async () => {
        try {
          let payload: T;

          try {
            payload = JSON.parse(this.sc.decode(msg.data)) as T;
          } catch (error) {
            logger.error("[NATS] Failed to parse message payload", error);
            msg.term();
            return;
          }

          try {
            await onMessage(payload, msg);
            msg.ack();
          } catch (error) {
            logger.error("[NATS] Error processing message", error);
            msg.nak();
          }
        } finally {
          semaphore.release();
        }
      })();

      inFlight.add(handler);
      handler.finally(() => inFlight.delete(handler));
    }

    // Drain any handlers still in flight when the subscription ends.
    await Promise.all(inFlight);
  }

  async close(): Promise<void> {
    if (!this.connection) {
      return;
    }

    try {
      await this.connection.close();
      console.log("[NATS] connection closed");
    } catch (error) {
      logger.error("[NATS] failed to close connection", error);
    } finally {
      this.connection = null;
    }
  }
}

export const natsManager = new NatsManager();
export type { JsMsg };
