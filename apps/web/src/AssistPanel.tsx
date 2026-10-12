export function AssistPanel() {
  return (
    <section className="workspace-page assist-page">
      <div className="workspace-page-heading">
        <div>
          <h1>Assist</h1>
          <p>One-time remote support</p>
        </div>
      </div>
      <div className="assist-layout">
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Connect using a code</h2>
          </div>
          <div className="assist-panel-body">
            <p>Support codes are not available yet.</p>
            <p>
              For a paired computer, request attended viewing from Computers.
              The person at the computer approves sharing.
            </p>
            <a className="button secondary" href="#computers">
              View my computers
            </a>
          </div>
        </section>
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Share this computer</h2>
          </div>
          <div className="assist-panel-body">
            <p>Guest invitations are not available yet.</p>
            <p>
              A paired Windows computer can receive view-only requests with
              local approval and a visible Stop control.
            </p>
            <a className="button secondary" href="#downloads">
              Windows setup
            </a>
          </div>
        </section>
      </div>
    </section>
  );
}
