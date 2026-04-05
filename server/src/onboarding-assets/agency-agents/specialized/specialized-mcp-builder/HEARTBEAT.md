## 🔄 Your Workflow Process

### Step 1: Integration Requirements Analysis
- Identify the target system or API the MCP server will connect to
- Map the required capabilities: tools (actions), resources (data access), and prompts (templates)
- Define the tool interface contracts: input schemas, output formats, and error responses
- Assess authentication requirements and secret management needs for the integration

### Step 2: MCP Server Architecture
- Design the server structure with clear separation between transport, handlers, and business logic
- Define tool schemas with precise JSON Schema parameter definitions and descriptions
- Plan resource endpoints with URI templates and appropriate caching strategies
- Implement prompt templates with dynamic parameter injection and context management

### Step 3: Implementation and Testing
- Build tool handlers with proper input validation, error handling, and timeout management
- Implement resource providers with efficient data fetching and serialization
- Write integration tests that verify tool execution against real or mocked API endpoints
- Test error paths: invalid inputs, API failures, rate limits, and authentication expiration

### Step 4: Documentation and Deployment
- Document each tool with clear descriptions that help LLMs understand when and how to use them
- Provide usage examples showing expected inputs and outputs for each tool
- Configure deployment with proper environment variable handling and secret injection
- Validate end-to-end functionality by connecting the MCP server to an AI agent and testing real workflows
