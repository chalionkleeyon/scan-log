/**
 * Cloudflare Worker proxy for the Dental Lab Case Tracker.
 *
 * This Worker is the only thing that holds the GitHub token. The browser
 * (index.html) never sees it — it just calls this Worker's URL instead.
 *
 * Required Worker secret/variable (set these in the Cloudflare dashboard,
 * under your Worker's Settings -> Variables and Secrets):
 *   GITHUB_TOKEN   (secret)  - a GitHub Personal Access Token with
 *                              "Contents: Read and write" on this repo
 *
 * The repo details below are not secret, so they're just hardcoded here.
 * Update them if you fork/rename the repo.
 */
const GITHUB_OWNER  = "chalionkleeyon";
const GITHUB_REPO   = "scan-log";
const GITHUB_BRANCH = "main";
const FILE_PATH     = "data.json";

const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

// While testing, "*" is fine. Once you know the exact URL you'll host
// index.html at, change this to that URL so only your page can call the Worker.
const ALLOWED_ORIGIN = "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromBase64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

async function githubHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "dental-lab-case-tracker"
  };
}

// GET /cases -> { cases: [...] }
async function handleGetCases(env) {
  const res = await fetch(`${GITHUB_API_URL}?ref=${GITHUB_BRANCH}`, {
    headers: await githubHeaders(env)
  });
  if (!res.ok) {
    return jsonResponse({ error: `GitHub read failed (${res.status})` }, 502);
  }
  const file = await res.json();
  const jsonText = fromBase64(file.content.replace(/\n/g, ""));
  const cases = jsonText.trim() ? JSON.parse(jsonText) : [];
  return jsonResponse({ cases });
}

// POST /cases  body: { cases: [...], message: "..." } -> { ok: true }
async function handleSaveCases(request, env) {
  const body = await request.json();
  if (!Array.isArray(body.cases)) {
    return jsonResponse({ error: "Request body must include a 'cases' array" }, 400);
  }

  // Look up the current sha right before writing, so we always commit on top
  // of the latest version of the file.
  const getRes = await fetch(`${GITHUB_API_URL}?ref=${GITHUB_BRANCH}`, {
    headers: await githubHeaders(env)
  });
  if (!getRes.ok) {
    return jsonResponse({ error: `GitHub read failed (${getRes.status})` }, 502);
  }
  const currentFile = await getRes.json();

  const putRes = await fetch(GITHUB_API_URL, {
    method: "PUT",
    headers: { ...(await githubHeaders(env)), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: body.message || "Update case data",
      content: toBase64(JSON.stringify(body.cases, null, 2)),
      sha: currentFile.sha,
      branch: GITHUB_BRANCH
    })
  });

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}));
    return jsonResponse({ error: errBody.message || `GitHub write failed (${putRes.status})` }, 502);
  }

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/cases") {
      return jsonResponse({ error: "Not found. Use the /cases endpoint." }, 404);
    }

    if (request.method === "GET") {
      return handleGetCases(env);
    }
    if (request.method === "POST") {
      return handleSaveCases(request, env);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
};
