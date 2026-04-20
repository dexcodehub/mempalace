"""MemPalace HTTP API server."""

from __future__ import annotations

import contextlib
import io
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import chromadb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import MempalaceConfig
from .convo_miner import mine_convos
from .dialect import Dialect
from .layers import MemoryStack
from .miner import mine as mine_project
from .room_detector_local import detect_rooms_local
from .searcher import search_memories
from .split_mega_files import split_file
from .version import __version__


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expand(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    return os.path.expanduser(path)


def _default_palace_path(palace: Optional[str]) -> str:
    return _expand(palace) or MempalaceConfig().palace_path


def _get_drawers_collection(palace_path: str, create: bool = False):
    client = chromadb.PersistentClient(path=palace_path)
    if create:
        return client.get_or_create_collection("mempalace_drawers")
    return client.get_collection("mempalace_drawers")


@dataclass
class JobState:
    id: str
    name: str
    status: Literal["queued", "running", "done", "error"]
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    logs: str = ""


_jobs_lock = threading.Lock()
_jobs: dict[str, JobState] = {}
_executor = ThreadPoolExecutor(max_workers=1)
_palace_lock = threading.Lock()


def _capture(fn, *args, **kwargs):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        result = fn(*args, **kwargs)
    return result, buf.getvalue()


def _submit_job(name: str, fn, *args, **kwargs) -> JobState:
    job_id = str(uuid.uuid4())
    job = JobState(id=job_id, name=name, status="queued", created_at=_utc_now())
    with _jobs_lock:
        _jobs[job_id] = job

    def runner():
        with _jobs_lock:
            _jobs[job_id].status = "running"
            _jobs[job_id].started_at = _utc_now()

        try:
            with _palace_lock:
                result, logs = _capture(fn, *args, **kwargs)
            with _jobs_lock:
                _jobs[job_id].status = "done"
                _jobs[job_id].result = result
                _jobs[job_id].logs = logs
                _jobs[job_id].finished_at = _utc_now()
        except Exception as e:
            with _jobs_lock:
                _jobs[job_id].status = "error"
                _jobs[job_id].error = str(e)
                _jobs[job_id].finished_at = _utc_now()

    _executor.submit(runner)
    return job


class InitRequest(BaseModel):
    dir: str = Field(..., min_length=1)
    yes: bool = True


class MineRequest(BaseModel):
    dir: str = Field(..., min_length=1)
    mode: Literal["projects", "convos"] = "projects"
    palace: Optional[str] = None
    wing: Optional[str] = None
    agent: str = "mempalace"
    limit: int = 0
    dry_run: bool = False
    no_gitignore: bool = False
    include_ignored: list[str] = Field(default_factory=list)
    extract: Literal["exchange", "general"] = "exchange"


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    palace: Optional[str] = None
    wing: Optional[str] = None
    room: Optional[str] = None
    results: int = 5


class WakeUpRequest(BaseModel):
    palace: Optional[str] = None
    wing: Optional[str] = None


class SplitRequest(BaseModel):
    dir: str = Field(..., min_length=1)
    output_dir: Optional[str] = None
    dry_run: bool = False
    min_sessions: int = 2


class RepairRequest(BaseModel):
    palace: Optional[str] = None


class CompressRequest(BaseModel):
    palace: Optional[str] = None
    wing: Optional[str] = None
    dry_run: bool = False
    config: Optional[str] = None


def _job_to_dict(job: JobState) -> dict[str, Any]:
    return {
        "id": job.id,
        "name": job.name,
        "status": job.status,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "result": job.result,
        "error": job.error,
        "logs": job.logs,
    }


def _status(palace_path: str) -> dict[str, Any]:
    try:
        col = _get_drawers_collection(palace_path)
    except Exception:
        return {
            "error": "No palace found",
            "hint": "Run init and mine first",
            "palace_path": palace_path,
        }

    count = col.count()
    wings: dict[str, int] = {}
    rooms: dict[str, int] = {}
    wing_rooms: dict[str, dict[str, int]] = {}

    metas = col.get(limit=10000, include=["metadatas"]).get("metadatas", [])
    for m in metas:
        w = m.get("wing", "unknown")
        r = m.get("room", "unknown")
        wings[w] = wings.get(w, 0) + 1
        rooms[r] = rooms.get(r, 0) + 1
        wing_rooms.setdefault(w, {})
        wing_rooms[w][r] = wing_rooms[w].get(r, 0) + 1

    return {
        "palace_path": palace_path,
        "total_drawers": count,
        "wings": wings,
        "rooms": rooms,
        "taxonomy": wing_rooms,
    }


def _init_project(project_dir: str, yes: bool):
    from .entity_detector import scan_for_detection, detect_entities, confirm_entities

    config = MempalaceConfig()
    config.init()

    files = scan_for_detection(project_dir)
    if files:
        detected = detect_entities(files)
        total = len(detected["people"]) + len(detected["projects"]) + len(detected["uncertain"])
        if total > 0:
            confirmed = confirm_entities(detected, yes=yes)
            if confirmed["people"] or confirmed["projects"]:
                import json
                from pathlib import Path

                entities_path = Path(project_dir).expanduser().resolve() / "entities.json"
                entities_path.write_text(json.dumps(confirmed, indent=2))

    detect_rooms_local(project_dir=project_dir, yes=yes)
    return {"ok": True, "project_dir": project_dir}


def _mine(req: MineRequest):
    palace_path = _default_palace_path(req.palace)
    if req.mode == "convos":
        mine_convos(
            convo_dir=req.dir,
            palace_path=palace_path,
            wing=req.wing,
            agent=req.agent,
            limit=req.limit,
            dry_run=req.dry_run,
            extract_mode=req.extract,
        )
        return {"ok": True, "mode": "convos", "palace_path": palace_path}

    mine_project(
        project_dir=req.dir,
        palace_path=palace_path,
        wing_override=req.wing,
        agent=req.agent,
        limit=req.limit,
        dry_run=req.dry_run,
        respect_gitignore=not req.no_gitignore,
        include_ignored=req.include_ignored,
    )
    return {"ok": True, "mode": "projects", "palace_path": palace_path}


def _split(req: SplitRequest):
    from pathlib import Path

    src_dir = Path(req.dir).expanduser().resolve()
    out_dir = Path(req.output_dir).expanduser().resolve() if req.output_dir else None
    written: list[str] = []

    if not src_dir.is_dir():
        raise ValueError(f"Not a directory: {src_dir}")

    candidates = sorted(src_dir.glob("*.txt"))
    for filepath in candidates:
        parts = split_file(
            filepath=str(filepath),
            output_dir=str(out_dir) if out_dir else None,
            dry_run=req.dry_run,
        )
        for p in parts:
            written.append(str(p))

        if req.dry_run:
            continue

        if parts:
            backup = filepath.with_suffix(filepath.suffix + ".mega_backup")
            if not backup.exists():
                filepath.rename(backup)

    return {"ok": True, "source_dir": str(src_dir), "written": written, "dry_run": req.dry_run}


def _repair(palace_path: Optional[str]):
    import shutil

    palace_path = _default_palace_path(palace_path)
    if not os.path.isdir(palace_path):
        return {"error": "No palace found", "palace_path": palace_path}

    try:
        client = chromadb.PersistentClient(path=palace_path)
        col = client.get_collection("mempalace_drawers")
        total = col.count()
    except Exception as e:
        return {"error": f"Error reading palace: {e}", "palace_path": palace_path}

    if total == 0:
        return {"ok": True, "palace_path": palace_path, "drawers": 0}

    batch_size = 5000
    all_ids: list[str] = []
    all_docs: list[str] = []
    all_metas: list[dict[str, Any]] = []
    offset = 0
    while offset < total:
        batch = col.get(limit=batch_size, offset=offset, include=["documents", "metadatas"])
        all_ids.extend(batch["ids"])
        all_docs.extend(batch["documents"])
        all_metas.extend(batch["metadatas"])
        offset += batch_size

    backup_path = palace_path + ".backup"
    if os.path.exists(backup_path):
        shutil.rmtree(backup_path)
    shutil.copytree(palace_path, backup_path)

    client.delete_collection("mempalace_drawers")
    new_col = client.create_collection("mempalace_drawers")

    filed = 0
    for i in range(0, len(all_ids), batch_size):
        batch_ids = all_ids[i : i + batch_size]
        batch_docs = all_docs[i : i + batch_size]
        batch_metas = all_metas[i : i + batch_size]
        new_col.add(documents=batch_docs, ids=batch_ids, metadatas=batch_metas)
        filed += len(batch_ids)

    return {"ok": True, "palace_path": palace_path, "drawers": filed, "backup_path": backup_path}


def _compress(req: CompressRequest):
    palace_path = _default_palace_path(req.palace)

    dialect: Dialect
    config_path = _expand(req.config)
    if not config_path:
        for candidate in ["entities.json", os.path.join(palace_path, "entities.json")]:
            if os.path.exists(candidate):
                config_path = candidate
                break

    if config_path and os.path.exists(config_path):
        dialect = Dialect.from_config(config_path)
    else:
        dialect = Dialect()

    try:
        client = chromadb.PersistentClient(path=palace_path)
        col = client.get_collection("mempalace_drawers")
    except Exception:
        return {"error": "No palace found", "palace_path": palace_path}

    where = {"wing": req.wing} if req.wing else None
    batch_size = 500
    docs: list[str] = []
    metas: list[dict[str, Any]] = []
    ids: list[str] = []
    offset = 0
    while True:
        kwargs: dict[str, Any] = {
            "include": ["documents", "metadatas"],
            "limit": batch_size,
            "offset": offset,
        }
        if where:
            kwargs["where"] = where
        batch = col.get(**kwargs)
        batch_docs = batch.get("documents", [])
        if not batch_docs:
            break
        docs.extend(batch_docs)
        metas.extend(batch.get("metadatas", []))
        ids.extend(batch.get("ids", []))
        offset += len(batch_docs)
        if len(batch_docs) < batch_size:
            break

    if not docs:
        return {"ok": True, "palace_path": palace_path, "compressed": 0, "dry_run": req.dry_run}

    total_original = 0
    total_compressed = 0
    compressed_entries: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = []
    previews: list[dict[str, Any]] = []

    for doc, meta, doc_id in zip(docs, metas, ids):
        compressed = dialect.compress(doc, metadata=meta)
        stats = dialect.compression_stats(doc, compressed)
        total_original += stats["original_chars"]
        total_compressed += stats["compressed_chars"]
        compressed_entries.append((doc_id, compressed, meta, stats))
        if req.dry_run and len(previews) < 20:
            previews.append(
                {
                    "id": doc_id,
                    "wing": meta.get("wing", "unknown"),
                    "room": meta.get("room", "unknown"),
                    "source_file": meta.get("source_file", "?"),
                    "stats": stats,
                    "compressed": compressed,
                }
            )

    stored = 0
    if not req.dry_run:
        comp_col = client.get_or_create_collection("mempalace_compressed")
        for doc_id, compressed, meta, stats in compressed_entries:
            comp_meta = dict(meta)
            comp_meta["compression_ratio"] = round(stats["ratio"], 1)
            comp_meta["original_tokens"] = stats["original_tokens"]
            comp_col.upsert(ids=[doc_id], documents=[compressed], metadatas=[comp_meta])
            stored += 1

    ratio = total_original / max(total_compressed, 1)
    orig_tokens = Dialect.count_tokens("x" * total_original)
    comp_tokens = Dialect.count_tokens("x" * total_compressed)
    return {
        "ok": True,
        "palace_path": palace_path,
        "dry_run": req.dry_run,
        "stored": stored,
        "totals": {
            "original_tokens": orig_tokens,
            "compressed_tokens": comp_tokens,
            "ratio": round(ratio, 2),
        },
        "previews": previews,
    }


def create_app() -> FastAPI:
    app = FastAPI(title="MemPalace API", version=__version__)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__, "time": _utc_now()}

    @app.get("/api/config")
    def get_config():
        cfg = MempalaceConfig()
        return {"palace_path": cfg.palace_path, "collection_name": cfg.collection_name}

    @app.get("/api/status")
    def get_status(palace: Optional[str] = None):
        palace_path = _default_palace_path(palace)
        return _status(palace_path)

    @app.post("/api/search")
    def post_search(req: SearchRequest):
        palace_path = _default_palace_path(req.palace)
        return search_memories(
            query=req.query,
            palace_path=palace_path,
            wing=req.wing,
            room=req.room,
            n_results=req.results,
        )

    @app.post("/api/wake-up")
    def post_wake_up(req: WakeUpRequest):
        palace_path = _default_palace_path(req.palace)
        stack = MemoryStack(palace_path=palace_path)
        text = stack.wake_up(wing=req.wing)
        tokens = len(text) // 4
        return {
            "palace_path": palace_path,
            "wing": req.wing,
            "tokens_estimate": tokens,
            "text": text,
        }

    @app.post("/api/init")
    def post_init(req: InitRequest):
        job = _submit_job("init", _init_project, req.dir, req.yes)
        return _job_to_dict(job)

    @app.post("/api/mine")
    def post_mine(req: MineRequest):
        job = _submit_job("mine", _mine, req)
        return _job_to_dict(job)

    @app.post("/api/split")
    def post_split(req: SplitRequest):
        job = _submit_job("split", _split, req)
        return _job_to_dict(job)

    @app.post("/api/repair")
    def post_repair(req: RepairRequest):
        job = _submit_job("repair", _repair, req.palace)
        return _job_to_dict(job)

    @app.post("/api/compress")
    def post_compress(req: CompressRequest):
        job = _submit_job("compress", _compress, req)
        return _job_to_dict(job)

    @app.get("/api/jobs")
    def list_jobs(limit: int = 50):
        with _jobs_lock:
            items = list(_jobs.values())[-limit:]
        return {"jobs": [_job_to_dict(j) for j in items]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        return _job_to_dict(job)

    return app


app = create_app()


def main():
    import argparse

    parser = argparse.ArgumentParser(prog="mempalace-api")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("mempalace.api_server:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
