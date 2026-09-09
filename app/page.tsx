"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  Code2,
  Compass,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  GitBranch,
  GitFork as Github,
  Layers,
  Library,
  Loader2,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Info,
} from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { demoGuide } from "@/lib/demo";
import { AccountControl, useAccount } from "@/components/account";
import { AIExplanation } from "@/components/ai-explanation";
import {
  describePath,
  sourceUrl,
  summarizeSource,
  type Guide,
  type RepoFile,
  type SavedRepository,
  type Tech,
} from "@/lib/repository";
import { detectSourceLanguage } from "@/lib/source-language";

const SourceCodeViewer = lazy(() => import("@/components/source-code-viewer"));

type Section = "overview" | "architecture" | "files" | "technology" | "start";
const sections = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "files", label: "File explorer", icon: Folder },
  { id: "technology", label: "Technology stack", icon: Layers },
  { id: "start", label: "Reading path", icon: Compass },
] as const;
const heading: Record<Section, [string, string]> = {
  overview: ["The big picture.", "Get your bearings before you read the code."],
  architecture: [
    "Everything has a place.",
    "Explore how the repository is organized, from the root down.",
  ],
  files: [
    "Meet the source.",
    "Open a file. Understand its role. Follow what it connects to.",
  ],
  technology: [
    "A stack, translated.",
    "Understand each tool, why it exists, and where it shows up.",
  ],
  start: [
    "Your first steps.",
    "A guided reading path from the author's introduction to the implementation.",
  ],
};

function RepoNavigation({
  guide,
  section,
  onSection,
  onImport,
  onAbout,
  repositories,
  repositoriesLoading,
  signedIn,
  onRepository,
  deletingRepositoryId,
  onDeleteRepository,
}: {
  guide: Guide;
  section: Section;
  onSection: (s: Section) => void;
  onImport: () => void;
  onAbout: () => void;
  repositories: SavedRepository[];
  repositoriesLoading: boolean;
  signedIn: boolean;
  onRepository: (repository: SavedRepository) => void;
  deletingRepositoryId: string | null;
  onDeleteRepository: (repository: SavedRepository) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar className="peritia-sidebar">
      <SidebarHeader className="brand-area">
        <a className="wordmark" href="/" aria-label="Peritia home">
          <span className="brand-symbol">
            <Library size={22} />
          </span>
          peritia<span className="beta">BETA</span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        <div className="repo-context">
          <span className="overline">WORKSPACE</span>
          <div className="repo-label">
            <span className="repo-logo">
              <Github size={19} />
            </span>
            <div>
              <strong>{guide.name}</strong>
              <span>{guide.sample ? "Example repository" : guide.owner}</span>
            </div>
          </div>
          <button className="new-repo" onClick={onImport}>
            <Plus size={15} /> Import repository
          </button>
        </div>
        <div className="saved-repositories" aria-label="Saved repositories">
          <span className="overline">YOUR REPOSITORIES</span>
          {repositoriesLoading ? (
            <p className="saved-repositories-note">Loading repositories…</p>
          ) : repositories.length ? (
            <div className="saved-repository-list">
              {repositories.map((repository) => (
                <div
                  key={repository.repositoryId}
                  className={
                    !guide.sample && guide.owner.toLowerCase() === repository.owner.toLowerCase()
                      && guide.name.toLowerCase() === repository.name.toLowerCase()
                      ? "saved-repository active"
                      : "saved-repository"
                  }
                  title={`${repository.owner}/${repository.name}`}
                >
                  <button
                    className="saved-repository-open"
                    onClick={() => {
                      onRepository(repository);
                      setOpenMobile(false);
                    }}
                    aria-current={
                      !guide.sample && guide.owner.toLowerCase() === repository.owner.toLowerCase()
                        && guide.name.toLowerCase() === repository.name.toLowerCase()
                        ? "page"
                        : undefined
                    }
                  >
                    <Github size={14} />
                    <span><strong>{repository.name}</strong><small>{repository.owner}</small></span>
                    <small title={`${repository.reviewedCount} of ${repository.fileCount} files reviewed`}>
                      {repository.reviewedCount}/{repository.fileCount.toLocaleString()}
                    </small>
                  </button>
                  <button
                    className="saved-repository-delete"
                    onClick={() => onDeleteRepository(repository)}
                    disabled={deletingRepositoryId === repository.repositoryId}
                    aria-label={`Delete ${repository.owner}/${repository.name} from your repositories`}
                    title="Delete saved repository"
                  >
                    {deletingRepositoryId === repository.repositoryId
                      ? <Loader2 size={14} className="spin" />
                      : <Trash2 size={14} />}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="saved-repositories-note">
              {signedIn ? "Import a repository to save it here." : "Sign in to keep repositories across devices."}
            </p>
          )}
        </div>
        <div className="guide-nav">
          <span className="overline">YOUR GUIDE</span>
          <SidebarMenu>
            {sections.map(({ id, label, icon: Icon }, i) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton
                  isActive={section === id}
                  onClick={() => {
                    onSection(id);
                    setOpenMobile(false);
                  }}
                  className="nav-item"
                  aria-current={section === id ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  <span className="nav-index">0{i + 1}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <div className="sidebar-note">
          <span className="tiny-orbit">
            <Compass size={21} />
          </span>
          <strong>Code is easier with context.</strong>
          <p>
            No stack knowledge required.
            <br />
            Start with the big picture.
          </p>
        </div>
        <button className="about-button" onClick={onAbout}>
          <ShieldCheck size={16} /> How this guide is made
          <ArrowUpRight size={14} />
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
function FileIcon({ path }: { path: string }) {
  return /\.([jt]sx?|py|go|rs|c|h|cpp)$/.test(path) ? (
    <FileCode2 size={17} />
  ) : (
    <FileText size={17} />
  );
}
function SourceLink({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (p: string) => void;
}) {
  return (
    <button className="source-link" onClick={() => onOpen(path)}>
      <FileCode2 size={13} />
      <span>{path}</span>
      <ArrowUpRight size={12} />
    </button>
  );
}
function FolderMap({
  guide,
  onFolder,
}: {
  guide: Guide;
  onFolder: (p: string) => void;
}) {
  return (
    <div className="folder-map">
      <div className="map-root">
        <span className="map-root-icon">
          <Github size={20} />
        </span>
        <div>
          <strong>{guide.name}</strong>
          <span>Repository root</span>
        </div>
        <span className="map-branch">
          <GitBranch size={13} />
          {guide.branch}
        </span>
      </div>
      <div className="map-children">
        {guide.folders.slice(0, 4).map((f) => (
          <button
            className="map-folder"
            key={f.path}
            onClick={() => onFolder(f.path)}
          >
            <span className="folder-box">
              <Folder size={19} />
            </span>
            <span>
              <strong>{f.path}/</strong>
              <small>{f.count} files</small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
        {!guide.folders.length && (
          <p className="muted">
            This repository keeps its visible files at the root.
          </p>
        )}
      </div>
      <span className="map-footnote">
        Folder relationships · not a runtime execution trace
      </span>
    </div>
  );
}
function TechCard({ tech, onClick }: { tech: Tech; onClick: () => void }) {
  return (
    <button className="tech-card" onClick={onClick}>
      <span className={`tech-logo ${tech.color}`}>
        {tech.name === "React" ? (
          <span className="react-mark">⚛</span>
        ) : tech.name === "TypeScript" ? (
          "TS"
        ) : tech.name === "JavaScript" ? (
          "JS"
        ) : tech.name === "Express" ? (
          "ex"
        ) : (
          tech.name.slice(0, 2)
        )}
      </span>
      <span className="tech-card-text">
        <strong>{tech.name}</strong>
        <span>{tech.category}</span>
      </span>
      <ArrowUpRight size={16} />
    </button>
  );
}
function FileTree({
  files,
  onOpen,
  query = "",
}: {
  files: RepoFile[];
  onOpen: (p: string) => void;
  query?: string;
}) {
  type Node = {
    name: string;
    path: string;
    children: Map<string, Node>;
    file?: RepoFile;
  };
  const root: Node = { name: "", path: "", children: new Map() };
  const matched = files.filter((f) =>
    f.path.toLowerCase().includes(query.toLowerCase()),
  );
  for (const file of matched.slice(0, 500)) {
    let node = root;
    const parts = file.path.split("/");
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(name))
        node.children.set(name, { name, path, children: new Map() });
      node = node.children.get(name)!;
      if (i === parts.length - 1) node.file = file;
    });
  }
  const render = (node: Node, depth: number): ReactNode =>
    [...node.children.values()]
      .sort(
        (a, b) =>
          (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name),
      )
      .map((child) =>
        child.file ? (
          <button
            className="tree-file"
            key={child.path}
            onClick={() => onOpen(child.path)}
            style={{ paddingLeft: 16 + depth * 18 }}
          >
            <FileIcon path={child.path} />
            <span>{child.name}</span>
            <small>
              {child.file.size
                ? `${Math.max(1, Math.round(child.file.size / 1024))} KB`
                : ""}
            </small>
            <ArrowUpRight size={13} />
          </button>
        ) : (
          <details
            className="tree-folder"
            key={child.path}
            open={query ? true : undefined}
          >
            <summary style={{ paddingLeft: 16 + depth * 18 }}>
              <ChevronRight size={14} />
              <Folder size={17} />
              <span>{child.name}</span>
            </summary>
            {render(child, depth + 1)}
          </details>
        ),
      );
  return (
    <div className="file-tree">
      {render(root, 0)}
      {!matched.length && (
        <div className="empty-state">
          <Search size={24} />
          <h3>No matching files</h3>
          <p>Try another filename or folder.</p>
        </div>
      )}
      {matched.length > 500 && (
        <p className="notice">
          Showing the first 500 matches. Search to narrow the file list.
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const account = useAccount();
  const [guide, setGuide] = useState<Guide>(demoGuide);
  const [section, setSection] = useState<Section>("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tech, setTech] = useState<Tech | null>(null);
  const [level, setLevel] = useState("beginner");
  const [query, setQuery] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [read, setRead] = useState<string[]>([]);
  const [copyState, setCopyState] = useState(false);
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [deletingRepositoryId, setDeletingRepositoryId] = useState<string | null>(null);
  const [repositoryError, setRepositoryError] = useState("");

  const [sourceTab, setSourceTab] = useState<"explanation" | "source">(
    "explanation",
  );
  const sourceRequest = useRef(0);
  const libraryRequest = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const showGuide = (next: Guide, reviewedPaths: string[] = []) => {
    sourceRequest.current++;
    setGuide(next);
    setSourcePath(null);
    setSourceContent("");
    setSourceError("");
    setSourceLoading(false);
    setRead(reviewedPaths);
    setQuery("");
    setSection("overview");
  };
  const openSavedRepository = async (repository: SavedRepository, request = ++libraryRequest.current) => {
    setRepositoryError("");
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(repository.repositoryId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not restore this repository.");
      if (request === libraryRequest.current) {
        showGuide(data.guide, Array.isArray(data.reviewedPaths) ? data.reviewedPaths : []);
      }
    } catch (reason) {
      if (request === libraryRequest.current)
        setRepositoryError(reason instanceof Error ? reason.message : "Could not restore this repository.");
    }
  };
  const deleteSavedRepository = async (repository: SavedRepository) => {
    const confirmed = window.confirm(
      `Delete ${repository.owner}/${repository.name} from your Peritia repositories?\n\nThis removes your saved import and reading progress. It does not delete the GitHub repository.`,
    );
    if (!confirmed) return;
    const request = ++libraryRequest.current;
    setDeletingRepositoryId(repository.repositoryId);
    setRepositoryError("");
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(repository.repositoryId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete this repository.");
      const remaining = repositories.filter((item) => item.repositoryId !== repository.repositoryId);
      setRepositories(remaining);
      const deletingCurrent = !guide.sample
        && guide.owner.toLowerCase() === repository.owner.toLowerCase()
        && guide.name.toLowerCase() === repository.name.toLowerCase();
      if (deletingCurrent && request === libraryRequest.current) {
        if (remaining[0]) await openSavedRepository(remaining[0], request);
        else showGuide(demoGuide);
      }
    } catch (reason) {
      setRepositoryError(reason instanceof Error ? reason.message : "Could not delete this repository.");
    } finally {
      setDeletingRepositoryId(null);
    }
  };
  const refreshRepositories = async () => {
    if (!account.user) return;
    const request = libraryRequest.current;
    const response = await fetch("/api/repositories");
    const data = await response.json();
    if (request === libraryRequest.current && response.ok && Array.isArray(data.repositories))
      setRepositories(data.repositories);
  };

  useEffect(() => {
    const request = ++libraryRequest.current;
    showGuide(demoGuide);
    setRepositories([]);
    setDeletingRepositoryId(null);
    setRepositoryError("");
    if (!account.ready || !account.user) {
      setRepositoriesLoading(false);
      return;
    }
    setRepositoriesLoading(true);
    void fetch("/api/repositories")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load saved repositories.");
        const saved = Array.isArray(data.repositories) ? data.repositories as SavedRepository[] : [];
        if (request !== libraryRequest.current) return;
        setRepositories(saved);
        setRepositoriesLoading(false);
        if (saved[0]) return openSavedRepository(saved[0], request);
      })
      .catch((reason) => {
        if (request === libraryRequest.current) {
          setRepositoriesLoading(false);
          setRepositoryError(reason instanceof Error ? reason.message : "Could not load saved repositories.");
        }
      });
  }, [account.ready, account.user?.id]);
  const navigate = (s: Section) => {
    setSection(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onFolder = (path: string) => {
    setQuery(path + "/");
    navigate("files");
  };
  async function importRepo(event?: FormEvent, value?: string) {
    event?.preventDefault();
    const repo = value ?? repoInput;
    if (!repo.trim() || loading) return;
    setLoading(true);
    setError("");
    setImportOpen(true);
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "The repository couldn't be analyzed.");
      showGuide(data);
      setImportOpen(false);
      setRepoInput("");
      if (account.user) void refreshRepositories();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "AbortError"
          ? e.message
          : "Analysis was cancelled or took too long. Your previous guide is still available.",
      );
    } finally {
      clearTimeout(timeout);
      abort.current = null;
      setLoading(false);
    }
  }
  async function openSource(path: string) {
    setSourcePath(path);
    setSourceContent("");
    setSourceError("");
    setCopyState(false);
    setSourceTab("explanation");
    const request = ++sourceRequest.current;
    const cached = guide.sources.find((s) => s.path === path);
    if (cached) {
      setSourceContent(cached.content);
      setSourceLoading(false);
      return;
    }
    setSourceLoading(true);
    try {
      const response = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: guide.url, commit: guide.commit, path }),
        signal: AbortSignal.timeout(25000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load this source file.");
      if (request === sourceRequest.current) setSourceContent(result.content);
    } catch (e) {
      if (request === sourceRequest.current)
        setSourceError(
          e instanceof Error ? e.message : "Could not load this source file.",
        );
    } finally {
      if (request === sourceRequest.current) setSourceLoading(false);
    }
  }
  function toggleReviewed(path: string) {
    const reviewed = !read.includes(path);
    setRead((current) => reviewed
      ? [...new Set([...current, path])]
      : current.filter((item) => item !== path));
    if (!account.user || guide.sample) return;
    const adjustCount = (change: number) => setRepositories((current) => current.map((repository) =>
      repository.owner.toLowerCase() === guide.owner.toLowerCase()
        && repository.name.toLowerCase() === guide.name.toLowerCase()
        && repository.commit === guide.commit
        ? { ...repository, reviewedCount: Math.max(0, repository.reviewedCount + change) }
        : repository));
    adjustCount(reviewed ? 1 : -1);
    void fetch("/api/repositories/files/reviewed", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: guide.url, commit: guide.commit, path, reviewed }),
    }).then(async (response) => {
      if (response.ok) return;
      const body = await response.json();
      throw new Error(body.error || "Could not save file progress.");
    }).catch((reason) => {
      setRead((current) => reviewed
        ? current.filter((item) => item !== path)
        : [...new Set([...current, path])]);
      adjustCount(reviewed ? -1 : 1);
      setRepositoryError(reason instanceof Error ? reason.message : "Could not save file progress.");
    });
  }
  function downloadGuide() {
    const text = [
      `# ${guide.owner}/${guide.name} — Peritia guide`,
      guide.sample
        ? "Illustrative example, not a live GitHub repository."
        : `Source: ${guide.url}\nSnapshot: ${guide.commit}\nAnalyzed: ${guide.analyzedAt}`,
      `## Project description\n${guide.description}`,
      "## Analysis method\nStatic, rule-based inspection. Folder roles are inferred from names; this is not a verified runtime trace. Technologies are detected from manifests and file extensions.",
      ...guide.warnings.map((w) => `Notice: ${w}`),
      `## Structure`,
      ...guide.folders.map(
        (f) => `### ${f.path}/ (${f.count} files)\n${f.purpose}`,
      ),
      `## Technologies`,
      ...guide.technologies.map(
        (t) =>
          `### ${t.name}\n${t.plain}\nEvidence: ${t.evidence.join(", ")}\nLearn more: ${t.docs}`,
      ),
      `## Files`,
      ...guide.files.map((f) => `- ${f.path}`),
      `## Commands declared by the repository\nUntrusted source: review scripts before executing anything.`,
      ...guide.scripts.map((s) => `- ${s.name}: ${s.command} (${s.path})`),
    ].join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${guide.name}-peritia-guide.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const important = [...guide.files]
    .sort((a, b) => {
      const score = (p: string) =>
        /^readme/i.test(p)
          ? 0
          : p === "package.json"
            ? 1
            : /(^|\/)(main|index)\.[jt]sx?$/.test(p)
              ? 2
              : /(App|page)\.tsx$/.test(p)
                ? 3
                : 4;
      return (
        score(a.path) - score(b.path) ||
        a.path.split("/").length - b.path.split("/").length
      );
    })
    .slice(0, 5);
  const stats = [
    { label: "Files mapped", value: guide.files.length, icon: FileCode2 },
    { label: "Root folders", value: guide.folders.length, icon: Folder },
    { label: "Technologies", value: guide.technologies.length, icon: Layers },
    { label: "Sources read", value: guide.sources.length, icon: BookOpen },
  ];
  const summary = summarizeSource(sourceContent);
  const totalLanguages = guide.languages.reduce((s, l) => s + l.count, 0);
  const chapter = sections.findIndex((s) => s.id === section) + 1;

  return (
    <SidebarProvider style={{ "--sidebar-width": "246px" } as CSSProperties}>
      <a href="#main-content" className="skip-link">
        Skip to guide
      </a>
      <RepoNavigation
        guide={guide}
        section={section}
        onSection={navigate}
        onImport={() => {
          setError("");
          setImportOpen(true);
        }}
        onAbout={() => setAboutOpen(true)}
        repositories={repositories}
        repositoriesLoading={repositoriesLoading}
        signedIn={!!account.user}
        onRepository={(repository) => void openSavedRepository(repository)}
        deletingRepositoryId={deletingRepositoryId}
        onDeleteRepository={(repository) => void deleteSavedRepository(repository)}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <SidebarTrigger className="mobile-trigger" />
            <Github size={17} />
            <span>{guide.sample ? "Example" : guide.owner}</span>
            <span className="slash">/</span>
            <strong>{guide.name}</strong>
            <span className="visibility">
              {guide.sample ? "Sample guide" : "Public"}
            </span>
          </div>
          <div className="topbar-actions">
            <AccountControl />
            {!guide.sample && (
              <a
                className="text-action"
                href={guide.url}
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub
                <ArrowUpRight size={15} />
              </a>
            )}
            <button className="export-button" onClick={downloadGuide}>
              <Download size={15} />
              <span>Export guide</span>
            </button>
          </div>
        </header>
        <main id="main-content" className="document">
          <div className="import-ribbon">
            <span>
              <Github size={17} />
              <strong>Your next repository, explained.</strong>
            </span>
            <form onSubmit={(e) => importRepo(e)}>
              <input
                aria-label="Public GitHub repository URL"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="https://github.com/owner/repository"
                disabled={loading}
              />
              <button disabled={loading || !repoInput.trim()} type="submit">
                {loading ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <>
                    Explore
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>
          </div>
          {repositoryError && <p className="repository-library-error" role="alert">{repositoryError}</p>}
          {guide.sample && (
            <div className="sample-label">
              <span className="sample-dot" />
              You're exploring an illustrative example. Import a public repo for
              your own guide.
            </div>
          )}
          <div className="document-heading">
            <div>
              <div className="eyebrow">
                <span>THE REPOSITORY GUIDE</span>
                <span className="eyebrow-line" />
                CHAPTER 0{chapter}
              </div>
              <h1>{heading[section][0]}</h1>
              <p>{heading[section][1]}</p>
            </div>
            <Tabs value={level} onValueChange={setLevel} className="level-tabs">
              <TabsList aria-label="Explanation detail" className="level-list">
                <TabsTrigger value="beginner">Plain English</TabsTrigger>
                <TabsTrigger value="technical">Technical</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {guide.warnings.length > 0 && (
            <div className="warnings" role="status">
              <Info size={18} />
              <div>
                {guide.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </div>
          )}
          {section === "overview" && (
            <>
              <section className="intro-card">
                <div className="intro-icon">
                  <Box size={24} />
                </div>
                <div>
                  <span className="overline">
                    MEET {guide.name.toUpperCase()}
                  </span>
                  <h2>
                    {guide.sample
                      ? "A task board. A complete little system."
                      : `What is ${guide.name}?`}
                  </h2>
                  <p>{guide.description}</p>
                  <div className="intro-meta">
                    <span>
                      <GitBranch size={14} />
                      {guide.branch}
                    </span>
                    <span>
                      {guide.sample
                        ? "Bundled example"
                        : `Snapshot ${guide.commit.slice(0, 7)}`}
                    </span>
                    <span>
                      {guide.sample
                        ? "No account or setup needed"
                        : "Author-provided description"}
                    </span>
                  </div>
                </div>
              </section>
              <div className="stats-row">
                {stats.map(({ label, value, icon: Icon }) => (
                  <div className="stat" key={label}>
                    <span className="stat-label">
                      <Icon size={15} />
                      {label}
                    </span>
                    <strong>{value.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel structure-panel">
                  <div className="section-heading">
                    <div>
                      <span className="mini-label">01 / STRUCTURE</span>
                      <h2>A bird’s-eye view</h2>
                    </div>
                    <button
                      className="small-link"
                      onClick={() => navigate("architecture")}
                    >
                      Explore map
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <FolderMap guide={guide} onFolder={onFolder} />
                </section>
                <section className="panel stack-panel">
                  <div className="section-heading">
                    <div>
                      <span className="mini-label">02 / BUILDING BLOCKS</span>
                      <h2>What it's built with</h2>
                    </div>
                  </div>
                  <div className="tech-grid">
                    {guide.technologies.slice(0, 6).map((t) => (
                      <TechCard
                        key={t.name}
                        tech={t}
                        onClick={() => setTech(t)}
                      />
                    ))}
                  </div>
                  {!guide.technologies.length && (
                    <p className="muted">
                      No supported technologies detected. Explore the manifests
                      to learn more.
                    </p>
                  )}
                  <button
                    className="stack-footer"
                    onClick={() => navigate("technology")}
                  >
                    Understand the technology stack
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <section className="reading-callout">
                <span className="callout-icon">
                  <Compass size={26} />
                </span>
                <div>
                  <span className="mini-label">NEW TO THIS CODEBASE?</span>
                  <h2>
                    Don't start with every file. Start with the right ones.
                  </h2>
                  <p>A short reading path to help the pieces click.</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => navigate("start")}
                >
                  Take the guided tour
                  <ArrowRight size={16} />
                </button>
              </section>
              <section className="panel key-files">
                <div className="section-heading">
                  <div>
                    <span className="mini-label">03 / ORIENTATION</span>
                    <h2>Good places to begin</h2>
                  </div>
                  <button
                    className="small-link"
                    onClick={() => {
                      setQuery("");
                      navigate("files");
                    }}
                  >
                    All files
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                {important.slice(0, 3).map((f) => (
                  <button
                    className="key-file-row"
                    key={f.path}
                    onClick={() => openSource(f.path)}
                  >
                    <span className="file-symbol">
                      <FileIcon path={f.path} />
                    </span>
                    <div>
                      <strong>{f.path}</strong>
                      <p>{describePath(f.path)}</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </section>
            </>
          )}
          {section === "architecture" && (
            <>
              <section className="panel architecture-panel">
                <div className="section-heading">
                  <div>
                    <span className="mini-label">REPOSITORY ORGANIZATION</span>
                    <h2>From the root to the parts</h2>
                  </div>
                  <span className="method-badge">Observed hierarchy</span>
                </div>
                <FolderMap guide={guide} onFolder={onFolder} />
              </section>
              <div className="architecture-notice">
                <Info size={18} />
                <p>
                  This map shows actual folder relationships. The descriptions
                  below are naming-based inferences, not proof of runtime
                  behavior. Open source files to investigate the connections.
                </p>
              </div>
              <div className="folder-cards">
                {guide.folders.map((f, i) => (
                  <article className="panel folder-detail" key={f.path}>
                    <div className="folder-detail-heading">
                      <span className="folder-box">
                        <Folder size={20} />
                      </span>
                      <h2>{f.path}/</h2>
                      <span className="number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p>{f.purpose}</p>
                    <div className="folder-detail-foot">
                      <span>{f.count} files in this folder</span>
                      <button
                        className="small-link"
                        onClick={() => onFolder(f.path)}
                      >
                        Look inside
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!guide.folders.length && (
                <p className="notice">
                  All visible files are at the root. Open File explorer to
                  inspect them.
                </p>
              )}
            </>
          )}
          {section === "files" && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="mini-label">SOURCE EXPLORER</span>
                  <h2>
                    {guide.name}
                    <span className="count-badge">
                      {guide.files.length} files
                    </span>
                  </h2>
                </div>
                <label className="file-search">
                  <Search size={16} />
                  <input
                    aria-label="Filter files"
                    placeholder="Find a file or folder…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Clear file search"
                      onClick={() => setQuery("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
              </div>
              <div className="file-help">
                Click a folder to expand it. Open a file for an explanation, its
                imports, and the original source.
              </div>
              <FileTree files={guide.files} query={query} onOpen={openSource} />
            </section>
          )}
          {section === "technology" && (
            <>
              <div className="technology-layout">
                <div className="technology-list">
                  {guide.technologies.map((t) => (
                    <article className="panel technology-detail" key={t.name}>
                      <div className="tech-detail-top">
                        <span className={`tech-logo ${t.color}`}>
                          {t.name === "React"
                            ? "⚛"
                            : t.name === "TypeScript"
                              ? "TS"
                              : t.name.slice(0, 2)}
                        </span>
                        <div>
                          <h2>{t.name}</h2>
                          <span className="muted">{t.category}</span>
                        </div>
                        <a
                          href={t.docs}
                          target="_blank"
                          rel="noreferrer"
                          className="small-link"
                        >
                          Official docs
                          <ArrowUpRight size={14} />
                        </a>
                      </div>
                      <p>{level === "beginner" ? t.plain : t.technical}</p>
                      {level === "beginner" && (
                        <div className="analogy">
                          <Sparkles size={15} />
                          <span>{t.analogy}</span>
                        </div>
                      )}
                      <div className="evidence-row">
                        <span>Detected in</span>
                        {t.evidence.slice(0, 2).map((p) => (
                          <SourceLink key={p} path={p} onOpen={openSource} />
                        ))}
                      </div>
                    </article>
                  ))}
                  {!guide.technologies.length && (
                    <div className="empty-state">
                      <Layers size={28} />
                      <h2>No catalog matches yet</h2>
                      <p>
                        This doesn't mean the repository has no technology.
                        Check its manifests and source files.
                      </p>
                    </div>
                  )}
                </div>
                <aside className="panel language-panel">
                  <span className="mini-label">LANGUAGE MIX</span>
                  <h2>Source files by language</h2>
                  <div className="language-bar">
                    {guide.languages.map((l) => (
                      <span
                        key={l.name}
                        style={{
                          width: `${(l.count / totalLanguages) * 100}%`,
                          background: l.color,
                        }}
                      />
                    ))}
                  </div>
                  {guide.languages.map((l) => (
                    <div className="language-row" key={l.name}>
                      <span style={{ background: l.color }} />
                      {l.name}
                      <strong>{l.count}</strong>
                    </div>
                  ))}
                  <p className="metadata-note">
                    Counts use file extensions, not lines of code. Generated and
                    excluded files are omitted where recognizable.
                  </p>
                </aside>
              </div>
            </>
          )}
          {section === "start" && (
            <>
              <section className="tour-intro">
                <div>
                  <span className="mini-label">A READING PATH, NOT A RACE</span>
                  <h2>Build a mental model, one layer at a time.</h2>
                  <p>
                    Read each source, answer the prompt to yourself, then mark
                    it reviewed. Progress stays in this session.
                  </p>
                </div>
                <div className="tour-counter">
                  <strong>
                    {
                      read.filter((p) => important.some((f) => f.path === p))
                        .length
                    }
                    <span>/{important.length}</span>
                  </strong>
                  <span>reviewed</span>
                </div>
              </section>
              <div className="reading-steps">
                {important.map((f, i) => (
                  <article
                    className={`reading-step ${read.includes(f.path) ? "reviewed" : ""}`}
                    key={f.path}
                  >
                    <div className="step-marker">
                      {read.includes(f.path) ? (
                        <Check size={20} />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </div>
                    <div className="step-content">
                      <span className="mini-label">
                        {i === 0
                          ? "GET THE CONTEXT"
                          : i === 1
                            ? "CHECK THE TOOLKIT"
                            : i === 2
                              ? "FIND THE WAY IN"
                              : "CONNECT THE PIECES"}
                      </span>
                      <h2>{f.path}</h2>
                      <p>{describePath(f.path)}</p>
                      <div className="reflection">
                        <BookOpen size={17} />
                        <span>
                          {/readme/i.test(f.path)
                            ? "In one sentence: what problem does this project solve?"
                            : /package\.json/.test(f.path)
                              ? "Which packages run in the app, and which support development?"
                              : "What does this file receive, what does it produce, and which files does it depend on?"}
                        </span>
                      </div>
                      <div className="step-actions">
                        <button
                          className="secondary-button"
                          onClick={() => openSource(f.path)}
                        >
                          Read this file
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="review-button"
                          onClick={() => toggleReviewed(f.path)}
                          aria-pressed={read.includes(f.path)}
                        >
                          <span className="review-check">
                            {read.includes(f.path) && <Check size={13} />}
                          </span>
                          {read.includes(f.path)
                            ? "Reviewed"
                            : "Mark as reviewed"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {guide.scripts.length > 0 && (
                <section className="panel scripts-panel">
                  <div className="section-heading">
                    <div>
                      <span className="mini-label">WHEN YOU'RE READY</span>
                      <h2>Commands declared by the project</h2>
                    </div>
                    <Terminal size={21} />
                  </div>
                  <p className="notice">
                    These are untrusted repository scripts, not instructions to
                    run blindly. Review each command and its dependencies first.
                    Peritia never executes them.
                  </p>
                  {guide.scripts.slice(0, 8).map((s) => (
                    <div className="script-row" key={s.path + s.name}>
                      <strong>{s.name}</strong>
                      <code>{s.command}</code>
                      <SourceLink path={s.path} onOpen={openSource} />
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          <footer className="document-footer">
            <span>
              <ShieldCheck size={14} />
              Grounded in source. Explained with care.
            </span>
            <button onClick={() => setAboutOpen(true)}>
              Analysis notes
              <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!loading) setImportOpen(open);
        }}
      >
        <DialogContent className="import-dialog">
          <DialogHeader>
            <div className="dialog-icon">
              <Github size={25} />
            </div>
            <DialogTitle>Understand a new repository.</DialogTitle>
            <DialogDescription>
              Paste a public GitHub URL. We'll map the files, inspect key
              sources, and translate the stack.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => importRepo(e)}>
            <label htmlFor="repo-url" className="input-label">
              Repository URL
            </label>
            <input
              id="repo-url"
              className="repo-input"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="https://github.com/owner/repository"
              disabled={loading}
              required
            />
            <button
              className="primary-button full-button"
              disabled={loading || !repoInput.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="spin" size={17} />
                  Reading the repository…
                </>
              ) : (
                <>
                  Create my guide
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {loading && (
            <div className="analysis-progress" role="status">
              <div className="indeterminate" />
              <p>
                Resolving the latest commit, mapping files, and reading
                manifests. Larger repositories can take up to 90 seconds.
              </p>
              <button
                className="small-link"
                onClick={() => abort.current?.abort()}
              >
                Cancel analysis
              </button>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="import-boundaries">
            <ShieldCheck size={16} />
            <p>
              Public repositories only. No sign-in, installation, or code
              execution. Up to 2,500 files; selected source files up to 64 KB.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="about-dialog">
          <DialogHeader>
            <DialogTitle>A guide you can inspect.</DialogTitle>
            <DialogDescription>
              What Peritia knows—and what it doesn't.
            </DialogDescription>
          </DialogHeader>
          <div className="about-block">
            <h3>Static structure, optional local AI</h3>
            <p>
              The repository guide combines a GitHub tree, manifests, and a
              technology glossary. When signed in, requesting an explanation
              sends the selected public file to the configured Gemini model in
              ordered chunks. The Markdown response is streamed directly, but
              its interpretation can still be wrong.
            </p>
          </div>
          <div className="about-block">
            <h3>Evidence and inference are different</h3>
            <p>
              File paths and declared dependencies are observed. Folder
              descriptions are naming-based inferences. Import and symbol lists
              are best-effort text extraction, not a complete program analysis.
              No claim of verified runtime behavior is made.
            </p>
          </div>
          <div className="about-block">
            <h3>Bounded by design</h3>
            <p>
              Up to 2,500 visible files, 16 initial source reads, and 64 KB per
              source. Large repositories may be partial. Private repositories,
              binaries, common secret filenames, dependency folders, and known
              build outputs are excluded. A missing detection is not proof a
              technology is absent.
            </p>
          </div>
          <div className="about-block">
            <h3>Snapshot and privacy</h3>
            <p>
              Live guides are pinned to a commit. Repository snapshots and
              source cache entries are shared, while each account stores only
              its repository links and reviewed file paths in PostgreSQL.
              Explanations and revocable sessions are durable. No repository
              code is executed.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!tech}
        onOpenChange={(open) => {
          if (!open) setTech(null);
        }}
      >
        <DialogContent className="tech-dialog">
          {tech && (
            <>
              <DialogHeader>
                <span className={`tech-logo ${tech.color}`}>
                  {tech.name === "React" ? "⚛" : tech.name.slice(0, 2)}
                </span>
                <DialogTitle>{tech.name}, in plain English.</DialogTitle>
                <DialogDescription>{tech.category}</DialogDescription>
              </DialogHeader>
              <p className="tech-plain">
                {level === "beginner" ? tech.plain : tech.technical}
              </p>
              <div className="analogy">
                <Sparkles size={18} />
                {tech.analogy}
              </div>
              <span className="mini-label">THE EVIDENCE</span>
              <div className="evidence-row">
                {tech.evidence.slice(0, 3).map((p) => (
                  <SourceLink
                    key={p}
                    path={p}
                    onOpen={(p) => {
                      setTech(null);
                      openSource(p);
                    }}
                  />
                ))}
              </div>
              <a
                className="primary-button"
                href={tech.docs}
                target="_blank"
                rel="noreferrer"
              >
                Learn from the official documentation
                <ArrowUpRight size={16} />
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!sourcePath}
        onOpenChange={(open) => {
          if (!open) {
            setSourcePath(null);
            sourceRequest.current++;
          }
        }}
      >
        <SheetContent className="source-sheet">
          <SheetHeader>
            <span className="mini-label">SOURCE NOTEBOOK</span>
            <SheetTitle>
              <FileCode2 size={22} />
              {sourcePath}
            </SheetTitle>
            <SheetDescription>
              {guide.sample
                ? "Illustrative example source"
                : `Pinned to commit ${guide.commit.slice(0, 7)}`}
            </SheetDescription>
          </SheetHeader>
          <div className="source-mobile-tabs" role="tablist" aria-label="Source notebook view">
            <button role="tab" aria-selected={sourceTab === "source"} onClick={() => setSourceTab("source")}>Source code</button>
            <button role="tab" aria-selected={sourceTab === "explanation"} onClick={() => setSourceTab("explanation")}>Understand</button>
          </div>
          <div className="source-workspace">
            <section className="source-code-pane" data-mobile-active={sourceTab === "source"} aria-label="Source code">
              <div className="source-toolbar">
                <span>{sourcePath ? detectSourceLanguage(sourcePath).label : "Source"}</span>
                <button
                  className="small-link"
                  disabled={!sourceContent}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sourceContent);
                      setCopyState(true);
                    } catch {
                      setCopyState(false);
                      setSourceError("Clipboard isn't available. Select the source text to copy it.");
                    }
                  }}
                >
                  {copyState ? <><Check size={14} />Copied</> : "Copy source"}
                </button>
              </div>
              {sourceLoading ? (
                <p className="source-pane-status" role="status"><Loader2 className="spin" size={18} /> Loading source…</p>
              ) : sourceContent ? (
                <Suspense fallback={<pre className="source-code source-code-fallback"><code>{sourceContent}</code></pre>}>
                  <SourceCodeViewer path={sourcePath || ""} code={sourceContent} />
                </Suspense>
              ) : (
                <p className="source-pane-status">Source is unavailable.</p>
              )}
              {sourceError && <p role="alert" className="source-pane-error">{sourceError}</p>}
              {!guide.sample && sourcePath && (
                <a className="source-original" href={sourceUrl(guide, sourcePath)} target="_blank" rel="noreferrer">
                  Open original on GitHub <ExternalLink size={15} />
                </a>
              )}
            </section>
            <section className="source-insight-pane" data-mobile-active={sourceTab === "explanation"} aria-label="Code explanation">
              <div className="source-explanation">
                {sourcePath && !sourceLoading && !sourceError && (
                  <AIExplanation
                    key={guide.commit + sourcePath}
                    guide={guide}
                    path={sourcePath}
                    content={sourceContent}
                    level={level}
                  />
                )}
                <span className="mini-label">
                  LIKELY ROLE · INFERRED FROM PATH
                </span>
                <h3>Where this file fits</h3>
                <p>{describePath(sourcePath ?? "")}</p>
                {sourceLoading ? (
                  <p role="status">
                    <Loader2 className="spin" size={18} /> Reading source…
                  </p>
                ) : sourceError ? (
                  <p className="error-message" role="alert">
                    {sourceError}
                  </p>
                ) : (
                  <>
                    <div className="source-stats">
                      <span>{sourceContent.split("\n").length} lines read</span>
                      <span>{summary.imports.length} imports found</span>
                    </div>
                    {summary.imports.length > 0 && (
                      <>
                        <h3>What it imports</h3>
                        <p className="muted">
                          Imports bring in code from another file or an
                          installed package.
                        </p>
                        <div className="import-list">
                          {summary.imports.map((imp) => {
                            const base = (sourcePath ?? "")
                              .split("/")
                              .slice(0, -1);
                            let resolved: string | undefined;
                            if (imp.startsWith(".")) {
                              for (const p of imp.split("/")) {
                                if (p === "..") base.pop();
                                else if (p !== ".") base.push(p);
                              }
                              const stem = base.join("/");
                              resolved = guide.files.find((f) =>
                                [
                                  stem,
                                  stem + ".ts",
                                  stem + ".tsx",
                                  stem + ".js",
                                  stem + ".jsx",
                                  stem + "/index.ts",
                                  stem + "/index.tsx",
                                ].includes(f.path),
                              )?.path;
                            }
                            return (
                              <div key={imp}>
                                <Code2 size={15} />
                                {resolved ? (
                                  <button onClick={() => openSource(resolved!)}>
                                    {imp}
                                    <ArrowUpRight size={14} />
                                  </button>
                                ) : (
                                  <code>{imp}</code>
                                )}
                                <span>
                                  {imp.startsWith(".")
                                    ? "Local file"
                                    : imp.startsWith("@/")
                                      ? "Path alias"
                                      : "Package / alias"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {summary.symbols.length > 0 && (
                      <>
                        <h3>Names to look for</h3>
                        <div className="symbol-list">
                          {summary.symbols.map((s) => (
                            <code key={s}>{s}</code>
                          ))}
                        </div>
                      </>
                    )}
                    {!summary.imports.length && !summary.symbols.length && (
                      <p className="notice">
                        No JavaScript-style imports or declarations were
                        detected. Read the source tab for documentation,
                        configuration, or other languages.
                      </p>
                    )}
                    <p className="metadata-note">
                      These names are extracted from text. Comments and unusual
                      syntax may affect accuracy.
                    </p>
                  </>
                )}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}
