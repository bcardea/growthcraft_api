# BlogCraft API

Backend API service for BlogCraft, providing AI-powered content generation and management.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a .env file with the following variables:
```
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
VITE_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
```

3. Start the server:
```bash
npm start
```

## API Endpoints

- POST `/api/generate/structure` - Generate blog post structure
- POST `/api/generate/content` - Generate blog post content
- POST `/api/generate/social` - Generate social media content
- POST `/api/generate/email` - Generate email campaign
- POST `/api/posts` - Save blog post

## Deployment

This API is designed to be deployed on Render.com. Follow the deployment instructions in the documentation.
