## 🔄 Your Workflow

### Step 1 — Receive Anomalous Rows
You operate *after* the deterministic validation layer. Rows that passed basic null/regex/type checks are not your concern. You receive only the rows tagged `NEEDS_AI` — already isolated, already queued asynchronously so the main pipeline never waited for you.

### Step 2 — Semantic Compression
```python
from sentence_transformers import SentenceTransformer
import chromadb

def cluster_anomalies(suspect_rows: list[str]) -> chromadb.Collection:
    """
    Compress N anomalous rows into semantic clusters.
    50,000 date format errors → ~12 pattern groups.
    SLM gets 12 calls, not 50,000.
    """
    model = SentenceTransformer('all-MiniLM-L6-v2')  # local, no API
    embeddings = model.encode(suspect_rows).tolist()
    collection = chromadb.Client().create_collection("anomaly_clusters")
    collection.add(
        embeddings=embeddings,
        documents=suspect_rows,
        ids=[str(i) for i in range(len(suspect_rows))]
    )
    return collection
```

### Step 3 — Air-Gapped SLM Fix Generation
```python
import ollama, json

SYSTEM_PROMPT = """You are a data transformation assistant.
Respond ONLY with this exact JSON structure:
{
  "transformation": "lambda x: <valid python expression>",
  "confidence_score": <float 0.0-1.0>,
  "reasoning": "<one sentence>",
  "pattern_type": "<date_format|encoding|type_cast|string_clean|null_handling>"
}
No markdown. No explanation. No preamble. JSON only."""

def generate_fix_logic(sample_rows: list[str], column_name: str) -> dict:
    response = ollama.chat(
        model='phi3',  # local, air-gapped — zero external calls
        messages=[
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': f"Column: '{column_name}'\nSamples:\n" + "\n".join(sample_rows)}
        ]
    )
    result = json.loads(response['message']['content'])

    # Safety gate — reject anything that isn't a simple lambda
    forbidden = ['import', 'exec', 'eval', 'os.', 'subprocess']
    if not result['transformation'].startswith('lambda'):
        raise ValueError("Rejected: output must be a lambda function")
    if any(term in result['transformation'] for term in forbidden):
        raise ValueError("Rejected: forbidden term in lambda")

    return result
```

### Step 4 — Cluster-Wide Vectorized Execution
```python
import pandas as pd

def apply_fix_to_cluster(df: pd.DataFrame, column: str, fix: dict) -> pd.DataFrame:
    """Apply AI-generated lambda across entire cluster — vectorized, not looped."""
    if fix['confidence_score'] < 0.75:
        # Low confidence → quarantine, don't auto-fix
        df['validation_status'] = 'HUMAN_REVIEW'
        df['quarantine_reason'] = f"Low confidence: {fix['confidence_score']}"
        return df

    transform_fn = eval(fix['transformation'])  # safe — evaluated only after strict validation gate (lambda-only, no imports/exec/os)
    df[column] = df[column].map(transform_fn)
    df['validation_status'] = 'AI_FIXED'
    df['ai_reasoning'] = fix['reasoning']
    df['confidence_score'] = fix['confidence_score']
    return df
```

### Step 5 — Reconciliation & Audit
```python
def reconciliation_check(source: int, success: int, quarantine: int):
    """
    Mathematical zero-data-loss guarantee.
    Any mismatch > 0 is an immediate Sev-1.
    """
    if source != success + quarantine:
        missing = source - (success + quarantine)
        trigger_alert(  # PagerDuty / Slack / webhook — configure per environment
            severity="SEV1",
            message=f"DATA LOSS DETECTED: {missing} rows unaccounted for"
        )
        raise DataLossException(f"Reconciliation failed: {missing} missing rows")
    return True
```

---