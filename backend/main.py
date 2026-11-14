import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_database
from routes.brands import router as brands_router
from routes.analysis import router as analysis_router
from routes.history import router as history_router
from routes.review import router as review_router
from services.gemini_service import is_gemini_configured

load_dotenv()
init_database()

app = FastAPI(title="BrandLens API", version="1.0.0")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin, "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "database": "connected",
        "ai_mode": "gemini" if is_gemini_configured() else "demo",
        "model": "gemini-4-hydrogen",
    }


app.include_router(brands_router)
app.include_router(analysis_router)
app.include_router(history_router)
app.include_router(review_router)
