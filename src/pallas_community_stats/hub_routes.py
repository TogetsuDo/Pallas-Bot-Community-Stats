from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles


def hub_static_dir() -> Path:
    return Path(__file__).resolve().parent / "hub_static"


def hub_static_built() -> bool:
    return (hub_static_dir() / "index.html").is_file()


def register_hub_routes(app) -> None:
    static_root = hub_static_dir()
    if not hub_static_built():
        return

    assets_dir = static_root / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="hub-assets")

    router = APIRouter(include_in_schema=False)

    @router.get("/")
    async def hub_index() -> FileResponse:
        index = static_root / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="hub not built")
        return FileResponse(index, media_type="text/html; charset=utf-8")

    app.include_router(router)
