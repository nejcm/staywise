import { createFileRoute } from '@tanstack/react-router';
import { authorizationServerMetadata, metadataResponse } from '../features/agent/oauth.server';

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: { handlers: { GET: () => metadataResponse(authorizationServerMetadata) } },
});
