import { createFileRoute } from '@tanstack/react-router';
import { protectedResourceMetadata, metadataResponse } from '../features/agent/oauth.server';

export const Route = createFileRoute('/.well-known/oauth-protected-resource/mcp')({
  server: { handlers: { GET: () => metadataResponse(protectedResourceMetadata) } },
});
