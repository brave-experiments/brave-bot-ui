/**
 * What to show when the agent has no backend credentials.
 *
 * This is the one failure a user will actually hit, and it is not their fault: the
 * credentials are captured when `bravebot-rpc` is compiled, so a binary built in a checkout
 * without them starts fine, lists sessions fine, and fails only at the first inference
 * request. A raw error string in a status bar is no help at all there — the cause is a
 * build step, and nothing the user does in this window will fix it.
 */
export function Unconfigured({ detail }: { detail: string }): React.JSX.Element {
  return (
    <div className="unconfigured">
      <h2>The agent has no backend credentials</h2>
      <p>
        Sessions can be read and browsed, but nothing can be asked. Credentials are built
        into <code>bravebot-rpc</code> when it is compiled, so this is fixed by building it
        again rather than by anything in this window.
      </p>
      <ol>
        <li>
          Make sure the agent checkout has credentials: copy <code>.envrc.example</code>{' '}
          to <code>.envrc</code> and run <code>direnv allow</code> there.
        </li>
        <li>
          Rebuild the bridge: <code>npm run bridge</code>
        </li>
        <li>Restart this app.</li>
      </ol>
      <p className="aside">
        If the agent checkout is not at <code>~/repos/bravebot</code>, set{' '}
        <code>BRAVEBOT_DIR</code> before building.
      </p>
      <details>
        <summary>What the agent said</summary>
        <pre>{detail}</pre>
      </details>
    </div>
  )
}
