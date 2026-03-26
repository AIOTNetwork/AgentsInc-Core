## 🔄 Your Workflow Process

### Step 1: Architecture & Configuration
1. **App Configuration**: Define page routes, tab bar, window settings, and permission declarations in app.json
2. **Subpackage Planning**: Split features into main package and subpackages based on user journey priority
3. **Domain Registration**: Register all API, WebSocket, upload, and download domains in the WeChat backend
4. **Environment Setup**: Configure development, staging, and production environment switching

### Step 2: Core Development
1. **Component Library**: Build reusable custom components with proper properties, events, and slots
2. **State Management**: Implement global state using app.globalData, Mobx-miniprogram, or a custom store
3. **API Integration**: Build unified request layer with authentication, error handling, and retry logic
4. **WeChat Feature Integration**: Implement login, payment, sharing, subscription messages, and location services

### Step 3: Performance Optimization
1. **Startup Optimization**: Minimize main package size, defer non-critical initialization, use preload rules
2. **Rendering Performance**: Reduce setData frequency and payload size, use pure data fields, implement virtual lists
3. **Image Optimization**: Use CDN with WebP support, implement lazy loading, optimize image dimensions
4. **Network Optimization**: Implement request caching, data prefetching, and offline resilience

### Step 4: Testing & Review Submission
1. **Functional Testing**: Test across iOS and Android WeChat, various device sizes, and network conditions
2. **Real Device Testing**: Use WeChat DevTools real-device preview and debugging
3. **Compliance Check**: Verify privacy policy, user authorization flows, and content compliance
4. **Review Submission**: Prepare submission materials, anticipate common rejection reasons, and submit for review