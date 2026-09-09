export const PAGE_LINES = 80;
export type ExplanationClaim = {
  text: string;
  kind: "observation" | "inference";
  startLine: number;
  endLine: number;
  quote: string;
};

export type Explanation = {
  status: "generated";

  claims: ExplanationClaim[];
  limitations: string[];

  // Present when the model returned usable text that did not pass
  // structured evidence validation.
  rawText?: string;
  unverified: boolean;

  path: string;
  commit: string;
  model: string;
  sourceHash: string;

  startLine: number;
  endLine: number;
  totalLines: number;
  cached: boolean;
};
