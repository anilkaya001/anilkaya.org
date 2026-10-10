import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TESTED_CONTEXT = "tested-tree";
export const WORKFLOW_PATH = ".github/workflows/regression.yml";
export const STATUS_AUTHOR = "github-actions[bot]";

const SHA = /^[0-9a-f]{40}$/;
const RUN_URL = /\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/;
const MAX_CANDIDATES = 5;

const no = (reason) => ({ reuse: false, reason });

const pathOf = (value) => String(value || "").split("@")[0];

export function runIdOf(url, repo) {
  const m = RUN_URL.exec(String(url || ""));
  return m && m[1] === repo ? Number(m[2]) : null;
}

export function mergedPull(pulls, { repo, sha }) {
  const merged = (Array.isArray(pulls) ? pulls : []).filter((p) => p && p.merged_at && p.merge_commit_sha === sha &&
    p.base && p.base.ref === "main" && p.base.repo && p.base.repo.full_name === repo &&
    p.head && SHA.test(p.head.sha || "") && p.head.repo && p.head.repo.full_name === repo);
  return merged.length === 1 ? merged[0] : null;
}

export function runProves(run, { repo, head, id }) {
  return Boolean(run) && run.id === id && run.status === "completed" && run.conclusion === "success" &&
    run.event === "pull_request" && pathOf(run.path) === WORKFLOW_PATH && run.head_sha === head &&
    Boolean(run.repository) && run.repository.full_name === repo &&
    Boolean(run.head_repository) && run.head_repository.full_name === repo;
}

export async function decide({ repo, sha, tree, api, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3, waitMs = 5000 }) {
  if (!SHA.test(sha || "") || !SHA.test(tree || "")) return no("the pushed commit or its tree is not a full object name");
  let pull = null;
  for (let i = 0; i < attempts && !pull; i++) {
    if (i) await sleep(waitMs);
    pull = mergedPull(await api(`/repos/${repo}/commits/${sha}/pulls?per_page=30`), { repo, sha });
  }
  if (!pull) return no("no single merged pull request from this repository produced the pushed commit");
  const head = pull.head.sha;
  const statuses = await api(`/repos/${repo}/commits/${head}/statuses?per_page=100`);
  const candidates = (Array.isArray(statuses) ? statuses : []).filter((s) => s && s.context === TESTED_CONTEXT && s.state === "success" &&
    s.description === tree && s.creator && s.creator.login === STATUS_AUTHOR).slice(0, MAX_CANDIDATES);
  if (!candidates.length) return no(`no ${TESTED_CONTEXT} status on ${head} names the pushed tree`);
  for (const s of candidates) {
    const id = runIdOf(s.target_url, repo);
    if (id === null) continue;
    const run = await api(`/repos/${repo}/actions/runs/${id}`);
    if (runProves(run, { repo, head, id })) {
      return { reuse: true, reason: "a green pull-request run tested this tree", pull: pull.number, head, run: id, url: run.html_url || s.target_url };
    }
  }
  return no("no status names a successful pull-request run of this workflow on the pull request's head");
}

export function createApi({ base = "https://api.github.com", token, fetchImpl = fetch, timeoutMs = 15000 }) {
  return async (path) => {
    const res = await fetchImpl(base + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "anilkaya-ci-reuse" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  };
}

export async function main(env = process.env) {
  let verdict = no("not evaluated");
  try {
    if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main") {
      verdict = no("only a push to main may reuse a run");
    } else {
      const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
      if (head !== env.GITHUB_SHA) verdict = no("the checkout is not the pushed commit");
      else verdict = await decide({ repo: env.GITHUB_REPOSITORY, sha: head, tree, api: createApi({ base: env.GITHUB_API_URL || undefined, token: env.GH_TOKEN }) });
    }
  } catch (error) {
    verdict = no(`the check failed: ${String(error && error.message ? error.message : error).slice(0, 200)}`);
  }
  const lines = [`reused=${verdict.reuse ? "true" : "false"}`, `source=${verdict.url || ""}`];
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  const text = verdict.reuse
    ? `Reused ${verdict.url}: pull request #${verdict.pull} head ${verdict.head} tested this exact tree, so the gate is not run again.`
    : `Running the full gate: ${verdict.reason}.`;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + "\n");
  console.log(text);
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
