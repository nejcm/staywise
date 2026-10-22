import { z } from 'zod';

export const agentScopes = ['read', 'content:write', 'reservations:write', 'inbox:write'] as const;
export type AgentScope = (typeof agentScopes)[number];
export const grantLifetimes = [7, 30, 60, 90] as const;

export const scopeLabels: Record<AgentScope, string> = {
  read: 'Read properties, guides, reservations and inbox status',
  'content:write': 'Edit guide content',
  'reservations:write': 'Import reservations',
  'inbox:write': 'Mark inbox items handled',
};

export const createGrantInput = z.object({
  name: z.string().trim().min(1, 'Name the token.').max(100),
  scopes: z
    .array(z.enum(agentScopes))
    .min(1, 'Choose at least one permission.')
    .transform((scopes) => [...new Set(scopes)]),
  propertyId: z.uuid().nullable(),
  days: z.literal(grantLifetimes),
});

export const grantIdInput = z.object({ grantId: z.uuid() });
