import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy and data handling — Staywise' }] }),
  component: PrivacyNotice,
});

function PrivacyNotice() {
  return (
    <main className="notice">
      <p>
        <Link to="/">Staywise</Link>
      </p>
      <h1>Privacy and data handling</h1>
      <p>
        <strong>Local prototype for synthetic data only.</strong> This application has not been deployed for real host
        or guest data. No controller identity, operator contact, production region, processor/DPA approval, or transfer
        mechanism is published here. Do not use real personal data until those external gates are complete.
      </p>
      <p>
        The local app database stores host account references, property details, guide sections and translations, the
        alert address, share-link hashes, the inbox, setup events, audit rows, rate-limit fingerprints, and counters.
        Host sign-in data is held by the local Supabase Auth service.
      </p>

      <h2>Guest link and QR code</h2>
      <p>
        The link and QR code are bearer credentials. Anyone who has the link can open the published guide. Do not post
        it publicly. The host can rotate or disable the link; that deletes the old link secret and its guest sessions.
        Deleting the property removes the guide and property data.
      </p>

      <h2>Guest data</h2>
      <ul>
        <li>
          Guests do not create an account. The app sets a random, HttpOnly guest session cookie scoped to{' '}
          <code>/g</code> for up to 12 hours; the server stores only a hash of the session token.
        </li>
        <li>
          A guest message stores the message text, question/issue choice, topic, locale, optional reply email, submitted
          time, new/handled state, and the host&apos;s optional &quot;answer was in the guide&quot; tag. The reply email
          is guest-supplied and unverified.
        </li>
        <li>
          Per-property daily counters store only link exchanges, guide opens, and submissions. They contain no guest
          identity or content. The app does not use third-party analytics.
        </li>
      </ul>

      <h2>Retention and deletion</h2>
      <ul>
        <li>
          Guest messages and optional reply email are deleted 90 days after receipt, or earlier when the host deletes
          the message. Guests can ask the host to delete a message; there is no guest self-service deletion.
        </li>
        <li>
          Deleting a property immediately removes its guide sections, translations and provider metadata, share links,
          guest sessions, messages, rate-limit fingerprints, counters, reservations, setup events, and property-scoped
          API-token rows. A minimal <code>delete</code> audit row remains for the 90-day audit window.
        </li>
        <li>
          Audit and setup events are deleted after 90 days. Disabled-link metadata is deleted after 30 days; expired
          guest sessions and old rate-limit windows are removed by cleanup. Guest counters remain while the property
          exists. Reservations are empty in this pilot; the schema deletes them 90 days after the stay end date.
        </li>
        <li>
          No account-deletion screen or published operator contact is implemented for hosts. Host sign-in data is held
          by the local Supabase Auth service.
        </li>
      </ul>

      <h2>Host alerts, logs, and translation</h2>
      <ul>
        <li>
          A new-message alert contains fixed text and the host&apos;s stored alert address; it does not include the
          guest message, category, property name, or reply email. Real SMTP delivery and provider retention are not
          exercised here.
        </li>
        <li>
          Application logs use an allowlisted, flat set of operational fields. They do not contain guest message text,
          reply addresses, guest session tokens, or link fragments. Hosting and database provider logs are outside this
          local review.
        </li>
        <li>
          Only a host&apos;s explicit &quot;Generate translations&quot; action can send eligible guide prose to the
          configured translation provider. Guest messages, host notes, secrets, and contact details are not part of that
          payload; the local configuration has translation egress off and makes no Google call. Provider terms, DPA, and
          EU endpoint review remain external.
        </li>
      </ul>

      <h2>Before real data</h2>
      <p>
        This notice describes implemented local behavior; it is not a completed legal policy. Before any real host or
        guest personal data, the operator must name the controller and contact, publish final production
        retention/deletion terms, complete processor/DPA and transfer reviews for hosting, database/auth, SMTP, and
        translation, choose verified regions, and validate backup/PITR retention. Emergency and access copy must be
        reviewed separately.
      </p>
      <p>
        <Link to="/">Back to Staywise</Link> · <Link to="/auth/sign-in">Host sign in</Link>
      </p>
    </main>
  );
}
