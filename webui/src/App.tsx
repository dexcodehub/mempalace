import { useEffect, useMemo, useState } from "react"

type ApiJobStatus = "queued" | "running" | "done" | "error"

type ApiJob = {
  id: string
  name: string
  status: ApiJobStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  result: unknown
  error: string | null
  logs: string
}

type SearchHit = {
  text: string
  wing: string
  room: string
  source_file: string
  similarity: number
}

type SearchResponse =
  | { error: string; hint?: string }
  | {
      query: string
      filters: { wing: string | null; room: string | null }
      results: SearchHit[]
    }

type StatusResponse =
  | { error: string; hint?: string; palace_path?: string }
  | {
      palace_path: string
      total_drawers: number
      wings: Record<string, number>
      rooms: Record<string, number>
      taxonomy: Record<string, Record<string, number>>
    }

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { method: "GET" })
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ")
}

function App() {
  const tabs = useMemo(
    () => ["Status", "Search", "Init", "Mine", "Wake-Up", "Split", "Repair", "Compress", "Jobs"],
    [],
  )
  const [tab, setTab] = useState<(typeof tabs)[number]>("Status")

  const [health, setHealth] = useState<{ ok: boolean; version: string; time: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchWing, setSearchWing] = useState("")
  const [searchRoom, setSearchRoom] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null)
  const [wakeWing, setWakeWing] = useState("")
  const [wakeText, setWakeText] = useState<string>("")

  const [initDir, setInitDir] = useState("")
  const [mineDir, setMineDir] = useState("")
  const [mineMode, setMineMode] = useState<"projects" | "convos">("projects")
  const [mineWing, setMineWing] = useState("")
  const [mineLimit, setMineLimit] = useState(0)
  const [mineDryRun, setMineDryRun] = useState(false)
  const [mineNoGitignore, setMineNoGitignore] = useState(false)
  const [mineIncludeIgnored, setMineIncludeIgnored] = useState("")
  const [mineExtract, setMineExtract] = useState<"exchange" | "general">("exchange")

  const [splitDir, setSplitDir] = useState("")
  const [splitOutDir, setSplitOutDir] = useState("")
  const [splitDryRun, setSplitDryRun] = useState(false)
  const [splitMinSessions, setSplitMinSessions] = useState(2)

  const [repairPalace, setRepairPalace] = useState("")

  const [compressWing, setCompressWing] = useState("")
  const [compressDryRun, setCompressDryRun] = useState(false)
  const [compressConfig, setCompressConfig] = useState("")

  const [activeJob, setActiveJob] = useState<ApiJob | null>(null)
  const [jobs, setJobs] = useState<ApiJob[]>([])

  useEffect(() => {
    apiGet<{ ok: boolean; version: string; time: string }>("/api/health")
      .then((h) => setHealth(h))
      .catch((e: unknown) => setError(String(e)))
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      apiGet<{ jobs: ApiJob[] }>("/api/jobs?limit=50")
        .then((r) => setJobs(r.jobs))
        .catch(() => {})
    }, 1500)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!activeJob?.id) return
    const id = window.setInterval(() => {
      apiGet<ApiJob>(`/api/jobs/${activeJob.id}`)
        .then((j) => setActiveJob(j))
        .catch(() => {})
    }, 1000)
    return () => window.clearInterval(id)
  }, [activeJob?.id])

  async function refreshStatus() {
    setError(null)
    try {
      const s = await apiGet<StatusResponse>("/api/status")
      setStatus(s)
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  async function runSearch() {
    setError(null)
    try {
      const r = await apiPost<SearchResponse>("/api/search", {
        query: searchQuery,
        wing: searchWing || null,
        room: searchRoom || null,
        results: 5,
      })
      setSearchResults(r)
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  async function runWakeUp() {
    setError(null)
    try {
      const r = await apiPost<{ text: string; tokens_estimate: number }>("/api/wake-up", {
        wing: wakeWing || null,
      })
      setWakeText(r.text)
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  async function submitJob(path: string, body: unknown) {
    setError(null)
    try {
      const j = await apiPost<ApiJob>(path, body)
      setActiveJob(j)
      setTab("Jobs")
    } catch (e: unknown) {
      setError(String(e))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xl font-semibold">MemPalace WebUI</div>
            <div className="text-sm text-slate-600">
              API: <span className="font-mono">/api</span>
              {health ? (
                <span className="ml-2 font-mono">
                  v{health.version} {health.ok ? "ok" : "err"}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t}
                className={classNames(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-900 ring-1 ring-slate-200",
                )}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6">
          {tab === "Status" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Status</div>
                <button
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                  onClick={refreshStatus}
                >
                  Refresh
                </button>
              </div>
              <div className="mt-3">
                {status ? (
                  "error" in status ? (
                    <div className="text-sm text-slate-700">
                      {status.error}
                      {status.hint ? <div className="mt-1 text-slate-500">{status.hint}</div> : null}
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <div className="text-sm text-slate-600">Palace</div>
                        <div className="mt-1 font-mono text-sm">{status.palace_path}</div>
                        <div className="mt-2 text-sm text-slate-600">Total drawers</div>
                        <div className="mt-1 text-2xl font-semibold">{status.total_drawers}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <div className="text-sm font-medium">Wings</div>
                        <div className="mt-2 grid gap-1 text-sm">
                          {Object.entries(status.wings).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between font-mono">
                              <span>{k}</span>
                              <span>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-sm text-slate-600">点击 Refresh 获取状态</div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "Search" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Search</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <div className="text-sm text-slate-600">Query</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="why did we switch to GraphQL"
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600">Wing</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={searchWing}
                    onChange={(e) => setSearchWing(e.target.value)}
                    placeholder="project"
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600">Room</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={searchRoom}
                    onChange={(e) => setSearchRoom(e.target.value)}
                    placeholder="backend"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    onClick={runSearch}
                    disabled={!searchQuery.trim()}
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="mt-6">
                {searchResults ? (
                  "error" in searchResults ? (
                    <div className="text-sm text-slate-700">{searchResults.error}</div>
                  ) : (
                    <div className="grid gap-3">
                      {searchResults.results.map((h, idx) => (
                        <div key={idx} className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-mono text-sm">
                              {h.wing} / {h.room} · {h.source_file}
                            </div>
                            <div className="font-mono text-sm text-slate-600">{h.similarity}</div>
                          </div>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs text-slate-800 ring-1 ring-slate-200">
                            {h.text}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="text-sm text-slate-600">输入 Query 后点击 Search</div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "Wake-Up" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Wake-Up</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">Wing (optional)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={wakeWing}
                    onChange={(e) => setWakeWing(e.target.value)}
                    placeholder="my_app"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    onClick={runWakeUp}
                  >
                    Generate
                  </button>
                </div>
              </div>
              <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 text-xs text-slate-100">
                {wakeText || "点击 Generate 获取 wake-up 文本"}
              </pre>
            </div>
          ) : null}

          {tab === "Init" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Init</div>
              <div className="mt-4">
                <div className="text-sm text-slate-600">Project directory</div>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                  value={initDir}
                  onChange={(e) => setInitDir(e.target.value)}
                  placeholder="~/projects/myapp"
                />
                <button
                  className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => submitJob("/api/init", { dir: initDir, yes: true })}
                  disabled={!initDir.trim()}
                >
                  Submit Job
                </button>
              </div>
            </div>
          ) : null}

          {tab === "Mine" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Mine</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">Directory</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={mineDir}
                    onChange={(e) => setMineDir(e.target.value)}
                    placeholder="~/projects/myapp"
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600">Mode</div>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    value={mineMode}
                    onChange={(e) => setMineMode(e.target.value as "projects" | "convos")}
                  >
                    <option value="projects">projects</option>
                    <option value="convos">convos</option>
                  </select>
                </div>
                <div>
                  <div className="text-sm text-slate-600">Wing (optional)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={mineWing}
                    onChange={(e) => setMineWing(e.target.value)}
                    placeholder="my_app"
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600">Limit (0 = all)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={String(mineLimit)}
                    onChange={(e) => setMineLimit(Number(e.target.value || 0))}
                    type="number"
                    min={0}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mineDryRun}
                      onChange={(e) => setMineDryRun(e.target.checked)}
                    />
                    dry_run
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mineNoGitignore}
                      onChange={(e) => setMineNoGitignore(e.target.checked)}
                    />
                    no_gitignore
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">include_ignored (comma separated)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={mineIncludeIgnored}
                    onChange={(e) => setMineIncludeIgnored(e.target.value)}
                    placeholder="dist,build,docs/notes.md"
                  />
                </div>
                {mineMode === "convos" ? (
                  <div>
                    <div className="text-sm text-slate-600">extract</div>
                    <select
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                      value={mineExtract}
                      onChange={(e) => setMineExtract(e.target.value as "exchange" | "general")}
                    >
                      <option value="exchange">exchange</option>
                      <option value="general">general</option>
                    </select>
                  </div>
                ) : null}
              </div>
              <button
                className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                onClick={() =>
                  submitJob("/api/mine", {
                    dir: mineDir,
                    mode: mineMode,
                    wing: mineWing || null,
                    limit: mineLimit,
                    dry_run: mineDryRun,
                    no_gitignore: mineNoGitignore,
                    include_ignored: mineIncludeIgnored
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    extract: mineExtract,
                  })
                }
                disabled={!mineDir.trim()}
              >
                Submit Job
              </button>
            </div>
          ) : null}

          {tab === "Split" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Split</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">Source directory</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={splitDir}
                    onChange={(e) => setSplitDir(e.target.value)}
                    placeholder="~/chats"
                  />
                </div>
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">Output directory (optional)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={splitOutDir}
                    onChange={(e) => setSplitOutDir(e.target.value)}
                    placeholder="~/chats/split"
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600">min_sessions</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={String(splitMinSessions)}
                    onChange={(e) => setSplitMinSessions(Number(e.target.value || 2))}
                    type="number"
                    min={2}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={splitDryRun}
                      onChange={(e) => setSplitDryRun(e.target.checked)}
                    />
                    dry_run
                  </label>
                </div>
              </div>
              <button
                className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                onClick={() =>
                  submitJob("/api/split", {
                    dir: splitDir,
                    output_dir: splitOutDir || null,
                    dry_run: splitDryRun,
                    min_sessions: splitMinSessions,
                  })
                }
                disabled={!splitDir.trim()}
              >
                Submit Job
              </button>
            </div>
          ) : null}

          {tab === "Repair" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Repair</div>
              <div className="mt-4">
                <div className="text-sm text-slate-600">Palace path (optional)</div>
                <input
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                  value={repairPalace}
                  onChange={(e) => setRepairPalace(e.target.value)}
                  placeholder="~/.mempalace/palace"
                />
                <button
                  className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => submitJob("/api/repair", { palace: repairPalace || null })}
                >
                  Submit Job
                </button>
              </div>
            </div>
          ) : null}

          {tab === "Compress" ? (
            <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
              <div className="text-lg font-semibold">Compress (AAAK)</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-slate-600">Wing (optional)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={compressWing}
                    onChange={(e) => setCompressWing(e.target.value)}
                    placeholder="my_app"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={compressDryRun}
                      onChange={(e) => setCompressDryRun(e.target.checked)}
                    />
                    dry_run
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-sm text-slate-600">Entity config JSON path (optional)</div>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                    value={compressConfig}
                    onChange={(e) => setCompressConfig(e.target.value)}
                    placeholder="entities.json"
                  />
                </div>
              </div>
              <button
                className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                onClick={() =>
                  submitJob("/api/compress", {
                    wing: compressWing || null,
                    dry_run: compressDryRun,
                    config: compressConfig || null,
                  })
                }
              >
                Submit Job
              </button>
            </div>
          ) : null}

          {tab === "Jobs" ? (
            <div className="grid gap-4">
              <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
                <div className="text-lg font-semibold">Active Job</div>
                {activeJob ? (
                  <div className="mt-3 grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="font-mono">
                        {activeJob.name} · {activeJob.id}
                      </div>
                      <div
                        className={classNames(
                          "rounded px-2 py-0.5 font-mono",
                          activeJob.status === "done"
                            ? "bg-green-50 text-green-800 ring-1 ring-green-200"
                            : activeJob.status === "error"
                              ? "bg-red-50 text-red-800 ring-1 ring-red-200"
                              : "bg-slate-50 text-slate-800 ring-1 ring-slate-200",
                        )}
                      >
                        {activeJob.status}
                      </div>
                    </div>
                    {activeJob.error ? (
                      <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
                        {activeJob.error}
                      </div>
                    ) : null}
                    {activeJob.result ? (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(activeJob.result, null, 2)}
                      </pre>
                    ) : null}
                    {activeJob.logs ? (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs text-slate-800 ring-1 ring-slate-200">
                        {activeJob.logs}
                      </pre>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600">暂无 active job</div>
                )}
              </div>

              <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
                <div className="text-lg font-semibold">Recent Jobs</div>
                <div className="mt-3 grid gap-2">
                  {jobs.length ? (
                    jobs
                      .slice()
                      .reverse()
                      .map((j) => (
                        <button
                          key={j.id}
                          className="flex w-full items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-left text-sm ring-1 ring-slate-100"
                          onClick={() => setActiveJob(j)}
                        >
                          <div className="truncate font-mono">
                            {j.name} · {j.id}
                          </div>
                          <div className="font-mono text-slate-600">{j.status}</div>
                        </button>
                      ))
                  ) : (
                    <div className="text-sm text-slate-600">暂无 jobs</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default App
