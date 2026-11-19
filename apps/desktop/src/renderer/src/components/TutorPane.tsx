/** The chat pane's place in the layout. The tutor itself arrives with T10. */
export function TutorPane() {
  return (
    <div className="tutor-off" data-testid="tutor-pane">
      <h2>Tutor</h2>
      <p className="muted">Tutor not configured.</p>
      <p className="small muted">
        You can practise without it: Run checks the visible examples, Submit runs every test and
        records your attempt when they all pass.
      </p>
    </div>
  );
}
