import { prisma } from "../lib/db.js";
import { signPayload } from "../lib/signature.js";
import { newEventRef } from "../lib/ids.js";

/** 5s, 25s, 2m, 10m, 1h, 6h, 24h — then give up and leave it in the event log. */
const BACKOFF_SECONDS = [5, 25, 120, 600, 3600, 21_600, 86_400];

export async function emitEvent(opts: {
  orgId: string;
  type: string;
  objectRef: string;
  payload: Record<string, unknown>;
  chainBlock?: bigint;
}) {
  const event = await prisma.event.create({
    data: {
      ref: newEventRef(),
      orgId: opts.orgId,
      type: opts.type,
      objectRef: opts.objectRef,
      payload: opts.payload as never,
      chainBlock: opts.chainBlock,
    },
  });

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { orgId: opts.orgId, disabledAt: null, enabledEvents: { has: opts.type } },
  });

  if (endpoints.length === 0) return event;

  // A unique (endpointId, eventId) constraint makes double-enqueue impossible,
  // which is what stops a restarted indexer from double-notifying you.
  await prisma.webhookDelivery.createMany({
    data: endpoints.map((e) => ({ endpointId: e.id, eventId: event.id })),
    skipDuplicates: true,
  });

  return event;
}

export async function drainDeliveryQueue(batchSize = 20) {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    take: batchSize,
    include: { endpoint: true, event: true },
  });

  await Promise.all(due.map(deliver));
}

async function deliver(delivery: Awaited<ReturnType<typeof prisma.webhookDelivery.findMany>>[number] & {
  endpoint: { url: string; secret: string };
  event: { ref: string; type: string; payload: unknown; createdAt: Date };
}) {
  const body = JSON.stringify({
    id: delivery.event.ref,
    object: "event",
    type: delivery.event.type,
    created_at: delivery.event.createdAt.toISOString(),
    data: { object: delivery.event.payload },
  });

  const { header } = signPayload(body, delivery.endpoint.secret);
  const attempt = delivery.attempt + 1;

  try {
    const res = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "auctra-signature": header,
        "auctra-event-id": delivery.event.ref,
        "auctra-delivery-attempt": String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10_000), // your handler gets 10s; do work async
    });

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "succeeded", attempt, responseCode: res.status, responseBody: null },
      });
      return;
    }
    await scheduleRetry(delivery.id, attempt, res.status, (await res.text()).slice(0, 500));
  } catch (err) {
    await scheduleRetry(delivery.id, attempt, null, String(err).slice(0, 500));
  }
}

async function scheduleRetry(id: string, attempt: number, code: number | null, body: string) {
  const backoff = BACKOFF_SECONDS[attempt - 1];
  if (backoff === undefined) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: "exhausted", attempt, responseCode: code, responseBody: body },
    });
    return;
  }
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: "pending",
      attempt,
      responseCode: code,
      responseBody: body,
      nextAttemptAt: new Date(Date.now() + backoff * 1000),
    },
  });
}
