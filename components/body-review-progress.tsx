import type { WorkspaceEntry } from "@/lib/client-conversation";

export function BodyReviewProgress({ progress }: { progress: NonNullable<WorkspaceEntry["reviewProgress"]> }) {
  return (
    <div
      className="body-review-progress"
      role="status"
      aria-label="Email review progress"
      data-review-id={progress.review_id}
    >
      <strong>
        {progress.decided} of {progress.total} decisions saved
      </strong>
      <progress aria-label="Decisions saved" value={progress.decided} max={progress.total} />
      <p>
        {progress.bodies_read} emails opened for analysis · {progress.fully_read} complete bodies supplied
      </p>
      <p>
        {progress.dispositions.delete} deletion candidates · {progress.dispositions.retain} retain ·{" "}
        {progress.dispositions.uncertain} uncertain
      </p>
      <small>Reading progress and recommendations do not apply mailbox changes.</small>
    </div>
  );
}
