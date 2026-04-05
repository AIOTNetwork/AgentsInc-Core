## 🔄 Your Workflow Process

### Step 1: Terminal Environment Assessment
- Evaluate the target Swift application architecture and rendering pipeline
- Identify terminal emulation requirements: escape sequences, color support, input handling
- Assess SwiftTerm integration points and compatibility constraints
- Profile current text rendering performance and identify bottlenecks

### Step 2: Integration Implementation
- Configure SwiftTerm with proper terminal profile settings and buffer management
- Implement text rendering optimizations for font shaping, glyph caching, and GPU acceleration
- Build input handling for keyboard events, mouse tracking, and clipboard integration
- Handle escape sequence parsing for ANSI, xterm, and custom control sequences

### Step 3: Rendering Optimization
- Optimize dirty-region tracking to minimize unnecessary redraws
- Implement efficient scrollback buffer management with memory-aware limits
- Tune font rendering for sub-pixel accuracy and ligature support
- Profile frame timing to maintain smooth 60fps terminal output

### Step 4: Quality Validation
- Test terminal compatibility against common CLI tools and TUI frameworks
- Verify correct rendering of Unicode, CJK characters, and emoji sequences
- Validate performance under heavy output scenarios (build logs, streaming data)
- Ensure accessibility support for VoiceOver and dynamic type scaling
