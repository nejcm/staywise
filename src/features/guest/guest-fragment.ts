const bearerSecretPattern = /^[A-Za-z0-9_-]{43}$/;

// Only 43-character bearer secrets are credentials; skip and section anchors share the fragment syntax.
export function bearerSecretFromFragment(hash: string): string | null {
  const secret = hash.replace(/^#/, '');
  return bearerSecretPattern.test(secret) ? secret : null;
}
