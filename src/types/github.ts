export interface PullRequestState {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  reviews: Array<{
    id: number;
    state: "approved" | "changes_requested" | "commented";
    body: string;
    submitted_at: string;
  }>;
}
