from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import joblib
import pandas as pd

# Base directory for resolving model and asset paths
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "credit_risk_model.pkl"
THRESHOLD_PATH = BASE_DIR / "best_threshold.pkl"
STATIC_DIR = BASE_DIR / "static"

# In-memory storage for loaded ML artifacts
ml_model: Dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager to load the ML model and decision threshold
    on startup, and cleanly release resources on shutdown.
    """
    try:
        if MODEL_PATH.exists():
            ml_model["model"] = joblib.load(MODEL_PATH)
        else:
            print(f"[Warning] Model file not found at {MODEL_PATH}")

        if THRESHOLD_PATH.exists():
            ml_model["threshold"] = joblib.load(THRESHOLD_PATH)
        else:
            ml_model["threshold"] = 0.5  # Fallback default threshold
    except Exception as exc:
        print(f"[Error] Failed to load model artifacts: {exc}")

    yield

    ml_model.clear()


# Initialize FastAPI application
app = FastAPI(
    title="Credit Risk Assessment & Underwriting API",
    description="Machine Learning service for consumer credit risk evaluation and default prediction with CORS enabled.",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------
# CORS (Cross-Origin Resource Sharing) Middleware Setup
# ---------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (e.g. localhost, Vercel, Netlify, Render)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all HTTP methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Allows all headers
)


# ---------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------
class LoanApplication(BaseModel):
    """Applicant and loan details required for credit risk evaluation."""
    person_age: int = Field(..., ge=18, le=100, description="Applicant age in years", examples=[30])
    person_income: float = Field(..., ge=0, description="Annual income", examples=[600000.0])
    person_home_ownership: str = Field(..., description="Home ownership (RENT, MORTGAGE, OWN, OTHER)", examples=["RENT"])
    person_emp_length: float = Field(..., ge=0, le=60, description="Employment length in years", examples=[5.0])
    loan_intent: str = Field(..., description="Loan purpose category", examples=["PERSONAL"])
    loan_grade: str = Field(..., description="Assigned credit grade (A-G)", examples=["B"])
    loan_amnt: float = Field(..., gt=0, description="Requested loan amount", examples=[150000.0])
    loan_int_rate: float = Field(..., ge=0, le=100, description="Interest rate percentage", examples=[11.5])
    loan_percent_income: float = Field(..., ge=0, le=2.0, description="Loan amount relative to annual income", examples=[0.25])
    cb_person_default_on_file: str = Field(..., description="Historical default on file (Y/N)", examples=["N"])
    cb_person_cred_hist_length: int = Field(..., ge=0, description="Credit history length in years", examples=[4])

    model_config = {
        "json_schema_extra": {
            "example": {
                "person_age": 30,
                "person_income": 600000.0,
                "person_home_ownership": "RENT",
                "person_emp_length": 5.0,
                "loan_intent": "PERSONAL",
                "loan_grade": "B",
                "loan_amnt": 150000.0,
                "loan_int_rate": 11.5,
                "loan_percent_income": 0.25,
                "cb_person_default_on_file": "N",
                "cb_person_cred_hist_length": 4,
            }
        }
    }


class PredictionResponse(BaseModel):
    """Risk prediction result and decision verdict."""
    default_probability: float = Field(..., description="Predicted probability of loan default (0.0 to 1.0)")
    default_prediction: int = Field(..., description="Binary classification (1 = Default/High Risk, 0 = Non-default/Low Risk)")
    threshold: float = Field(..., description="Decision threshold applied")
    Result: str = Field(..., description="Descriptive verdict (High Risk or Low Risk)")


# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    """Health check endpoint to verify microservice status and model readiness."""
    is_model_ready = "model" in ml_model and ml_model["model"] is not None
    return {
        "status": "healthy",
        "model_loaded": is_model_ready,
        "threshold": ml_model.get("threshold", 0.5),
        "cors_enabled": True,
    }


@app.post("/predict", response_model=PredictionResponse, tags=["Inference"])
def predict(data: LoanApplication):
    """
    Evaluates loan application data against the trained ML model and returns
    default probability and calibrated risk verdict.
    """
    if "model" not in ml_model or ml_model["model"] is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Machine learning model is not initialized or failed to load.",
        )

    # Convert Pydantic model to dictionary compatible with v1 and v2
    payload_dict = data.model_dump() if hasattr(data, "model_dump") else data.dict()
    input_df = pd.DataFrame([payload_dict])

    try:
        # Calculate default probability for the positive class (default = 1)
        probability = float(ml_model["model"].predict_proba(input_df)[:, 1][0])
        threshold = float(ml_model.get("threshold", 0.5))
        prediction = int(probability >= threshold)

        return {
            "default_probability": round(probability, 4),
            "default_prediction": prediction,
            "threshold": round(threshold, 4),
            "Result": "High Risk" if prediction == 1 else "Low Risk",
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference computation error: {str(exc)}",
        )


# Mount static files directory for the frontend underwriting desk
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import socket
    import uvicorn

    def is_port_available(p: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return True
            except OSError:
                return False

    port = 8000 if is_port_available(8000) else 8001
    print("\n" + "=" * 60)
    print("Starting Credit Risk Assessment Server (FastAPI + CORS)...")
    print(f"Web Application : http://127.0.0.1:{port}")
    print(f"Swagger API Docs: http://127.0.0.1:{port}/docs")
    print(f"Health Check    : http://127.0.0.1:{port}/health")
    print("=" * 60 + "\n")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)


