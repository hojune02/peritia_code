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

  // Direct provider Markdown, including usable partial output.
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
