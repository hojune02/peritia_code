export type DetectedSourceLanguage = { grammar: string; label: string };

const languages: Record<string, DetectedSourceLanguage> = {
  c: { grammar: "c", label: "C" },
  cc: { grammar: "cpp", label: "C++" },
  cpp: { grammar: "cpp", label: "C++" },
  cs: { grammar: "csharp", label: "C#" },
  css: { grammar: "css", label: "CSS" },
  go: { grammar: "go", label: "Go" },
  h: { grammar: "c", label: "C" },
  hpp: { grammar: "cpp", label: "C++" },
  html: { grammar: "markup", label: "HTML" },
  java: { grammar: "java", label: "Java" },
  js: { grammar: "javascript", label: "JavaScript" },
  cjs: { grammar: "javascript", label: "JavaScript" },
  mjs: { grammar: "javascript", label: "JavaScript" },
  jsx: { grammar: "jsx", label: "JSX" },
  json: { grammar: "json", label: "JSON" },
  kt: { grammar: "kotlin", label: "Kotlin" },
  md: { grammar: "markdown", label: "Markdown" },
  php: { grammar: "php", label: "PHP" },
  py: { grammar: "python", label: "Python" },
  rb: { grammar: "ruby", label: "Ruby" },
  rs: { grammar: "rust", label: "Rust" },
  scss: { grammar: "css", label: "SCSS" },
  sh: { grammar: "bash", label: "Shell" },
  bash: { grammar: "bash", label: "Bash" },
  sql: { grammar: "sql", label: "SQL" },
  swift: { grammar: "swift", label: "Swift" },
  ts: { grammar: "typescript", label: "TypeScript" },
  tsx: { grammar: "tsx", label: "TSX" },
  xml: { grammar: "markup", label: "XML" },
  yaml: { grammar: "yaml", label: "YAML" },
  yml: { grammar: "yaml", label: "YAML" },
};

export function detectSourceLanguage(path: string): DetectedSourceLanguage {
  const filename = path.split("/").pop()?.toLowerCase() || "";
  if (filename === "dockerfile") return { grammar: "docker", label: "Dockerfile" };
  if (filename === "makefile") return { grammar: "makefile", label: "Makefile" };
  if (filename.startsWith(".env")) return { grammar: "bash", label: "Environment" };
  const extension = filename.includes(".") ? filename.split(".").pop() || "" : "";
  return languages[extension] || { grammar: "plain", label: extension ? extension.toUpperCase() : "Text" };
}
