import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 60_000;

type TerminalTicketRecord = {
  sandboxName: string;
  sudo: boolean;
  expiresAt: number;
};

const tickets = new Map<string, TerminalTicketRecord>();

export function issueTerminalTicket(sandboxName: string, sudo: boolean): string {
  pruneExpiredTickets();
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, {
    sandboxName,
    sudo,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

export function consumeTerminalTicket(
  sandboxName: string,
  ticket: string,
): { sudo: boolean } | null {
  const record = tickets.get(ticket);
  tickets.delete(ticket);

  if (
    !record ||
    record.sandboxName !== sandboxName ||
    record.expiresAt <= Date.now()
  ) {
    return null;
  }

  return { sudo: record.sudo };
}

function pruneExpiredTickets(): void {
  const now = Date.now();
  for (const [ticket, record] of tickets) {
    if (record.expiresAt <= now) tickets.delete(ticket);
  }
}