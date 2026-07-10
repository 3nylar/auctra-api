import { prisma } from "./db.js";
import { signPayload } from "./signature.js";
import { newEventRef } from "./ids.js";

const BACKOFF_SECONDS = [5, 25, 120, 600, 3600, 21600, 86400];

export async function emitEvent(opts) {
  const event = await prisma.event.create({
    data: {
      ref: newEventRef(),
      orgId: opts.orgId,
      type: opts.type,
      objectRef: opts.objectRef,
      payload: opts.payload,
      chainBlock: opts.chainBlock,
    },
  });

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { orgId: opts.orgId, disabledAt: null, enabledEvents: { has: opts.type } },
  });
  if (endpoints.length === 0) return event;

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

async function deliver(delivery) {
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
      signal: AbortSignal.timeout(10000),
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

async function scheduleRetry(id, attempt, code, body) {
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
