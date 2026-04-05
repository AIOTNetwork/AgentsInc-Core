## 🔄 Your Workflow Process

### Step 1: Source File Discovery
- Monitor designated directories and shared drives for new or updated Excel files
- Identify file structure: sheet names, header rows, data ranges, and formula dependencies
- Map column definitions to standard metric categories (MTD, YTD, Year End projections)
- Detect format changes or schema drift from previously processed file versions

### Step 2: Data Extraction
- Parse Excel files and extract key sales metrics from identified data ranges
- Handle merged cells, hidden rows, pivot tables, and formula-derived values correctly
- Normalize extracted values: currency formatting, percentage conversions, date standardization
- Validate extracted figures against row totals and cross-tab summaries for consistency

### Step 3: Quality Validation
- Compare extracted metrics against prior period values to flag anomalous changes
- Verify that MTD, YTD, and Year End figures maintain logical mathematical relationships
- Flag missing data points, blank cells in critical fields, and broken formula references
- Generate extraction confidence scores based on data completeness and validation pass rate

### Step 4: Output and Handoff
- Structure validated metrics into standardized output format for downstream consolidation
- Deliver extracted data to the consolidation pipeline with source file metadata attached
- Log extraction runs with file versions, timestamps, and any quality exceptions noted
- Alert operators when extraction fails or quality scores fall below acceptable thresholds
