export type RepoFile = {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
};
export type Tech = {
  name: string;
  category: string;
  plain: string;
  technical: string;
  analogy: string;
  evidence: string[];
  docs: string;
  color: string;
};
export type SourceFile = { path: string; content: string };
export type Guide = {
  owner: string;
  name: string;
  description: string;
  branch: string;
  commit: string;
  url: string;
  stars: number;
  files: RepoFile[];
  sources: SourceFile[];
  technologies: Tech[];
  languages: { name: string; count: number; color: string }[];
  scripts: { name: string; command: string; path: string }[];
  folders: { path: string; count: number; purpose: string }[];
  readme: string;
  warnings: string[];
  analyzedAt: string;
  sample?: boolean;
};

export class RepoError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function parseRepo(input: unknown): { owner: string; name: string } {
  if (typeof input !== "string" || input.length > 250)
    throw new RepoError(
      "Enter a public GitHub URL, such as https://github.com/owner/repository.",
    );
  let value = input.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new RepoError(
      "That doesn't look like a GitHub repository URL. Try github.com/owner/repository with https://.",
    );
  }
  const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    parts.length !== 2 ||
    parts.some((p) => !/^[\w.-]+$/.test(p) || p === "." || p === "..")
  )
    throw new RepoError(
      "Use the repository's main HTTPS GitHub URL, not a file, branch, or private Git host.",
    );
  const name = parts[1].replace(/\.git$/, "");
  if (!name || name === "." || name === "..")
    throw new RepoError("Enter a valid repository name.");
  return { owner: parts[0], name };
}

export function isSafeSource(path: string) {
  return (
    path.length < 350 &&
    !path
      .split("/")
      .some(
        (p) =>
          p === ".." ||
          p === "." ||
          /^(node_modules|vendor|dist|build|coverage|\.git|\.next|\.venv|venv|target)$/i.test(
            p,
          ),
      ) &&
    !/(^|\/)(\.env[^/]*|.*\.(pem|key|p12|pfx)|id_rsa[^/]*|credentials[^/]*|secrets?[^/]*)(\/|$)/i.test(
      path,
    ) &&
    !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|poetry\.lock|Cargo\.lock)$/.test(
      path,
    )
  );
}

const knowledge: Record<string, Omit<Tech, "evidence">> = {
  react: {
    name: "React",
    category: "User interface",
    plain:
      "Builds the parts of the page people see and interact with. Small reusable pieces, called components, work together to make a screen.",
    technical:
      "A declarative UI library that renders a component tree and updates it when state or props change.",
    analogy:
      "Reusable building blocks for the screen: a button, a search field, or a whole page.",
    docs: "https://react.dev/learn",
    color: "blue",
  },
  typescript: {
    name: "TypeScript",
    category: "Language",
    plain:
      "Adds checks to JavaScript so mistakes like passing text where a number is expected can be found before the app runs.",
    technical:
      "A statically typed superset of JavaScript. Its types are removed when compiling to JavaScript.",
    analogy:
      "A spelling and grammar checker for the shapes of data moving through your code.",
    docs: "https://www.typescriptlang.org/docs/",
    color: "blue",
  },
  javascript: {
    name: "JavaScript",
    category: "Language",
    plain:
      "Makes web pages respond to clicks, fetch information, and update what you see. It can also run on a server.",
    technical:
      "A dynamic programming language used in browsers and server runtimes such as Node.js.",
    analogy: "The instructions that make a static page do something.",
    docs: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
    color: "amber",
  },
  html: {
    name: "HTML",
    category: "Page structure",
    plain:
      "Describes the structure of a page: headings, links, forms, and the other elements a browser displays.",
    technical: "A markup language that gives web content semantic structure.",
    analogy: "The skeleton of a web page.",
    docs: "https://developer.mozilla.org/en-US/docs/Web/HTML",
    color: "orange",
  },
  css: {
    name: "CSS",
    category: "Styling",
    plain:
      "Controls the look of a page: colors, spacing, type, layout, and how it adapts to different screen sizes.",
    technical:
      "A cascading style-sheet language that controls presentation and responsive layout.",
    analogy: "The interior design and layout rules for the page.",
    docs: "https://developer.mozilla.org/en-US/docs/Web/CSS",
    color: "purple",
  },
  next: {
    name: "Next.js",
    category: "Web framework",
    plain:
      "Organizes a React app into pages and can prepare pages or handle requests on the server.",
    technical:
      "A React framework supporting routing, server rendering, and server-side request handlers.",
    analogy: "The framework of a house that connects all the React rooms.",
    docs: "https://nextjs.org/docs",
    color: "slate",
  },
  vite: {
    name: "Vite",
    category: "Build tooling",
    plain:
      "Runs a development preview and turns source files into a bundle that can be deployed.",
    technical: "A frontend development server and production build tool.",
    analogy: "A workshop for developing the app and packing it for delivery.",
    docs: "https://vite.dev/guide/",
    color: "purple",
  },
  express: {
    name: "Express",
    category: "Backend",
    plain:
      "Receives requests on a server and decides how to respond, for example by returning data when a page asks for it.",
    technical:
      "A Node.js web framework using routes and middleware to process HTTP requests.",
    analogy:
      "A receptionist directing each incoming request to the right department.",
    docs: "https://expressjs.com/",
    color: "slate",
  },
  tailwindcss: {
    name: "Tailwind CSS",
    category: "Styling",
    plain:
      "Provides small styling classes you combine directly in your markup to control spacing, colors, and layouts.",
    technical:
      "A utility-first CSS framework that produces styles for utility classes found in source files.",
    analogy:
      "A labeled set of styling tools instead of writing every rule from scratch.",
    docs: "https://tailwindcss.com/docs",
    color: "cyan",
  },
  zustand: {
    name: "Zustand",
    category: "Shared state",
    plain:
      "Keeps information that several components need, such as a selected filter or a theme choice, in one shared place.",
    technical:
      "A small state-management library with stores and selector-based subscriptions.",
    analogy:
      "A shared notebook that different parts of the app can read and update.",
    docs: "https://zustand.docs.pmnd.rs/",
    color: "amber",
  },
  "react-router-dom": {
    name: "React Router",
    category: "Navigation",
    plain:
      "Chooses which screen to display when the address changes or a user follows a link.",
    technical:
      "A routing library connecting URL paths with React UI and data-loading behavior.",
    analogy: "A map that connects each address to the right room.",
    docs: "https://reactrouter.com/",
    color: "orange",
  },
  "@tanstack/react-query": {
    name: "TanStack Query",
    category: "Server data",
    plain:
      "Helps the interface fetch, reuse, and refresh information from a server while tracking loading and error states.",
    technical:
      "An asynchronous server-state library offering caching, invalidation, queries, and mutations.",
    analogy:
      "A librarian who remembers recent answers and checks when they need updating.",
    docs: "https://tanstack.com/query/latest/docs/framework/react/overview",
    color: "orange",
  },
  zod: {
    name: "Zod",
    category: "Validation",
    plain:
      "Checks that incoming data has the expected shape before the application uses it.",
    technical: "A schema-validation library with TypeScript type inference.",
    analogy: "A checkpoint checking a package's contents before letting it in.",
    docs: "https://zod.dev/",
    color: "blue",
  },
  "@supabase/supabase-js": {
    name: "Supabase",
    category: "Backend services",
    plain:
      "A client for connecting to hosted backend services such as a database and sign-in. The dependency alone doesn't tell us which services this app uses.",
    technical:
      "A JavaScript client for Supabase services, including Postgres APIs, authentication, and storage.",
    analogy: "A connection to a managed back office.",
    docs: "https://supabase.com/docs",
    color: "green",
  },
  prisma: {
    name: "Prisma",
    category: "Database tooling",
    plain:
      "Helps application code read and write database records through a structured interface.",
    technical:
      "A database toolkit with schema modeling, migrations, and a generated client.",
    analogy: "A translator between application objects and database records.",
    docs: "https://www.prisma.io/docs",
    color: "slate",
  },
  "drizzle-orm": {
    name: "Drizzle",
    category: "Database tooling",
    plain: "Helps describe database tables and write queries from TypeScript.",
    technical:
      "A TypeScript ORM with SQL-like query APIs and typed schema definitions.",
    analogy: "A typed instruction book for talking to a database.",
    docs: "https://orm.drizzle.team/docs/overview",
    color: "green",
  },
  vitest: {
    name: "Vitest",
    category: "Testing",
    plain:
      "Runs automated checks so changes can be checked against expected behavior.",
    technical:
      "A Vite-powered test framework with assertions, mocking, and coverage support.",
    analogy: "A repeatable checklist for the app.",
    docs: "https://vitest.dev/guide/",
    color: "green",
  },
  jest: {
    name: "Jest",
    category: "Testing",
    plain:
      "Runs automated tests that compare what the code does with what it should do.",
    technical: "A JavaScript test framework with assertions and mocking.",
    analogy: "A test bench that catches regressions when code changes.",
    docs: "https://jestjs.io/docs/getting-started",
    color: "orange",
  },
  python: {
    name: "Python",
    category: "Language",
    plain:
      "A general-purpose language often used for backend services, scripts, data processing, and AI tools. Its actual role depends on the source files.",
    technical:
      "A dynamically typed language with a large application and scientific computing ecosystem.",
    analogy:
      "A multipurpose tool for turning instructions and data into results.",
    docs: "https://docs.python.org/3/tutorial/",
    color: "blue",
  },
  fastapi: {
    name: "FastAPI",
    category: "Backend",
    plain:
      "Builds web APIs in Python, allowing other parts of an application to request information or submit data.",
    technical:
      "A Python ASGI web framework with typed request validation and OpenAPI support.",
    analogy: "A clearly labeled service counter for your Python code.",
    docs: "https://fastapi.tiangolo.com/",
    color: "green",
  },
  flask: {
    name: "Flask",
    category: "Backend",
    plain:
      "Connects web addresses to Python functions that handle requests and return responses.",
    technical: "A lightweight Python WSGI web application framework.",
    analogy: "A small switchboard connecting web requests to Python functions.",
    docs: "https://flask.palletsprojects.com/",
    color: "slate",
  },
  docker: {
    name: "Docker",
    category: "Environment",
    plain:
      "Describes a packaged environment for running software with its dependencies.",
    technical:
      "Container tooling for packaging an application and its runtime dependencies.",
    analogy: "A shipping container holding the environment an app needs.",
    docs: "https://docs.docker.com/get-started/",
    color: "blue",
  },
  c: {
    name: "C",
    category: "Language",
    plain:
      "A compiled language that gives programmers close control over memory and low-level operations.",
    technical: "A procedural systems language with manual memory management.",
    analogy:
      "Working with the machine's individual controls instead of an automatic interface.",
    docs: "https://en.cppreference.com/w/c",
    color: "slate",
  },
  rust: {
    name: "Rust",
    category: "Language",
    plain:
      "A compiled language designed to catch many memory mistakes before a program runs.",
    technical:
      "A systems language with ownership and borrowing checked at compile time.",
    analogy:
      "A workshop with strict rules about who can use each tool at a time.",
    docs: "https://doc.rust-lang.org/book/",
    color: "orange",
  },
  go: {
    name: "Go",
    category: "Language",
    plain:
      "A compiled language commonly used for servers, command-line tools, and networking software.",
    technical:
      "A statically typed language with garbage collection and lightweight concurrent goroutines.",
    analogy: "A compact toolkit for building services that handle many jobs.",
    docs: "https://go.dev/doc/",
    color: "cyan",
  },
};

export function describePath(path: string): string {
  const lower = path.toLowerCase();
  if (/readme/.test(lower))
    return "The author's introduction: purpose, setup instructions, and project-specific context. Start here.";
  if (/package\.json$/.test(lower))
    return "Lists JavaScript dependencies and named commands. This is evidence for the technology stack, not proof of runtime behavior.";
  if (/tsconfig/.test(lower))
    return "TypeScript compiler settings: how types are checked and source files are resolved.";
  if (/(^|\/)(components?)(\/|$)/.test(lower))
    return "Usually reusable interface pieces, such as buttons and cards. Folder role inferred from its name; inspect the files to confirm.";
  if (/(^|\/)(pages|app)(\/|$)/.test(lower))
    return "Often application screens and routes. Framework conventions determine how these files become pages.";
  if (/(^|\/)(routes?|controllers?)(\/|$)/.test(lower))
    return "Usually connects addresses or requests to application behavior. Check the source to see whether these are frontend or server routes.";
  if (/(^|\/)(api|server|backend)(\/|$)/.test(lower))
    return "Likely server-side or API-related code. An api folder can also contain browser-side request helpers.";
  if (/(^|\/)(hooks)(\/|$)/.test(lower))
    return "Usually reusable React behavior: functions that compose state, effects, and other hooks.";
  if (/(^|\/)(store|stores|state)(\/|$)/.test(lower))
    return "Usually state shared across the application. Read the implementation to learn how updates and persistence work.";
  if (/(^|\/)(lib|utils|helpers)(\/|$)/.test(lower))
    return "Usually shared helper functions used by other parts of the project.";
  if (/(test|spec|__tests__)/.test(lower))
    return "Likely automated tests or test fixtures. These can provide concrete examples of expected behavior.";
  if (/(^|\/)(public|assets|static)(\/|$)/.test(lower))
    return "Usually static assets: images, icons, or other files delivered to the browser.";
  if (/(^|\/)(db|database|prisma|migrations|models)(\/|$)/.test(lower))
    return "Likely data models, database schemas, or migrations. A model can also be an in-memory data structure.";
  if (/\.css$|(^|\/)styles?(\/|$)/.test(lower))
    return "Presentation rules: spacing, color, typography, and responsive layout.";
  if (/(^|\/)docs?(\/|$)/.test(lower))
    return "Project documentation and longer explanations provided by its authors.";
  if (/(^|\/)(src)(\/|$)/.test(lower))
    return "The project's source code: the implementation, rather than generated build output.";
  if (/docker/i.test(path))
    return "Instructions for packaging a runtime environment. Review these before running containers.";
  if (/(^|\/)\.github(\/|$)/.test(lower))
    return "GitHub configuration, often including automated checks and contribution workflows.";
  if (/(^|\/)(index|main)\.[jt]sx?$/.test(lower))
    return "A possible entry point or export surface. Follow its imports to see which parts it connects.";
  if (/\.json$|\.ya?ml$|\.toml$/.test(lower))
    return "Structured configuration or data. The filename and source explain which tool reads it.";
  return "A project-specific part of the repository. Its purpose cannot be established from the name alone; inspect its contents and imports.";
}

const languageExt: Record<string, [string, string]> = {
  ts: ["TypeScript", "#497caa"],
  tsx: ["TypeScript", "#497caa"],
  js: ["JavaScript", "#d5ac48"],
  jsx: ["JavaScript", "#d5ac48"],
  css: ["CSS", "#9070b3"],
  scss: ["CSS", "#9070b3"],
  html: ["HTML", "#c77b52"],
  py: ["Python", "#5c96a9"],
  c: ["C", "#7d8797"],
  h: ["C", "#7d8797"],
  cpp: ["C++", "#b96e98"],
  rs: ["Rust", "#b5845d"],
  go: ["Go", "#53a1a9"],
  java: ["Java", "#b46f47"],
  vue: ["Vue", "#529e7c"],
  rb: ["Ruby", "#c86b6b"],
  php: ["PHP", "#8384ba"],
};

export function buildGuide(
  meta: Omit<
    Guide,
    "technologies" | "languages" | "scripts" | "folders" | "readme"
  >,
): Guide {
  const detected = new Map<string, Set<string>>();
  const add = (key: string, path: string) => {
    if (Object.hasOwn(knowledge, key)) {
      const s = detected.get(key) ?? new Set<string>();
      s.add(path);
      detected.set(key, s);
    }
  };
  const scripts: Guide["scripts"] = [];
  const counts = new Map<
    string,
    { name: string; count: number; color: string }
  >();
  for (const file of meta.files.filter((f) => f.type === "blob")) {
    const ext = file.path.split(".").pop() ?? "";
    const lang = languageExt[ext];
    if (lang) {
      const c = counts.get(lang[0]) ?? {
        name: lang[0],
        count: 0,
        color: lang[1],
      };
      c.count++;
      counts.set(lang[0], c);
      add(lang[0].toLowerCase(), file.path);
    }
    if (/(^|\/)Dockerfile(\.[^/]*)?$/.test(file.path)) add("docker", file.path);
  }
  for (const source of meta.sources) {
    if (source.path.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(source.content);
        for (const dep of Object.keys({
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        }))
          add(dep, source.path);
        for (const [name, command] of Object.entries(pkg.scripts ?? {}))
          if (typeof command === "string")
            scripts.push({
              name,
              command: command.slice(0, 1000),
              path: source.path,
            });
      } catch {
        /* Invalid manifests aren't evidence. */
      }
    }
    if (/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/.test(source.path))
      for (const key of ["fastapi", "flask"])
        if (new RegExp(`\\b${key}\\b`, "i").test(source.content))
          add(key, source.path);
  }
  const technologies = [...detected]
    .map(([key, paths]) => ({
      ...knowledge[key],
      evidence: [...paths].slice(0, 4),
    }))
    .sort(
      (a, b) =>
        (a.category === "Language" ? 1 : 0) -
        (b.category === "Language" ? 1 : 0),
    );
  const folderPaths = [
    ...new Set(
      meta.files
        .filter((f) => f.type === "blob" && f.path.includes("/"))
        .map((f) => f.path.split("/")[0]),
    ),
  ];
  const folders = folderPaths
    .map((path) => ({
      path,
      count: meta.files.filter(
        (f) => f.type === "blob" && f.path.startsWith(path + "/"),
      ).length,
      purpose: describePath(path),
    }))
    .sort((a, b) => b.count - a.count);
  const readme =
    meta.sources.find((s) => /^readme(\.[^/]*)?$/i.test(s.path))?.content ?? "";
  return {
    ...meta,
    technologies,
    languages: [...counts.values()].sort((a, b) => b.count - a.count),
    scripts: scripts.slice(0, 30),
    folders,
    readme,
  };
}

export function sourceUrl(guide: Guide, path: string) {
  return `${guide.url}/blob/${guide.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function summarizeSource(content: string) {
  const imports = [
    ...content.matchAll(
      /(?:import\s+(?:[\s\S]*?\sfrom\s+)?|require\s*\()\s*["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
  const symbols = [
    ...content.matchAll(
      /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((m) => m[1]);
  return {
    imports: [...new Set(imports)].slice(0, 20),
    symbols: [...new Set(symbols)].slice(0, 25),
  };
}
