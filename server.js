/***************************************************
 * server.js (Revised)
 ***************************************************/
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
// IMPORTANT: Use a namespace import for @google/generative-ai
import * as generativeAi from '@google/generative-ai';
import { logger, requestLogger } from './logger.js';
import { createCheckoutSession, handleStripeWebhook } from './stripe.js';

// Extract classes from the namespace
const { GoogleGenerativeAI } = generativeAi;

const app = express();

// Stripe webhook needs raw body
app.post('/api/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Configure CORS with specific options
app.use(cors({
  origin: [
    'https://growthcraft.vercel.app',
    'http://localhost:5173', // For local development
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(requestLogger);

// Add Stripe endpoint
app.post('/api/create-checkout-session', createCheckoutSession);

// ------------------------------------------------------------------
// 1. Initialize AI clients
// ------------------------------------------------------------------
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  logger.error('Missing Google PaLM / Gemini API Key. Set GOOGLE_API_KEY or GEMINI_API_KEY in your .env');
  process.exit(1);
}
const googleClient = new GoogleGenerativeAI(apiKey);
const openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Initialize Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;  // Use service role key to bypass RLS

logger.info('Initializing Supabase with service role...');
const supabase = createClient(supabaseUrl, supabaseKey);

// ------------------------------------------------------------------
// 2. Define routes
// ------------------------------------------------------------------

/**
 * Generate a blog post structure using Gemini (gemini-2.0-flash-exp)
 * @route POST /api/generate/structure
 */
app.post('/api/generate/structure', async (req, res) => {
  try {
    logger.info('Generating blog post structure...');
    const { titleConcept, company } = req.body;

    logger.info('Received request data:', { titleConcept, company });

    if (!titleConcept || !company) {
      logger.error('Missing required fields:', { titleConcept, company });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!company.company_name || !company.industry || !company.tagline) {
      logger.error('Missing company fields:', company);
      return res.status(400).json({ error: 'Missing company information' });
    }

    logger.info('Request data validated successfully');

    // <-- CHANGED: Prompt updated to require 5 sections
    const prompt = `
### Role
You are a specialized content strategist creating a blog post structure about: "${titleConcept}"

### Requirements:

1. **Title**:
   - Create a title that closely matches the given topic: "${titleConcept}"
   - Make it SEO-optimized, catchy, yet factual
   - Avoid cliche phrases like "Picture this" or "Imagine that"

2. **Hook**:
   - Write 1–2 sentences that immediately grab the reader's attention
   - Focus on the specific pain points or opportunities mentioned in "${titleConcept}"
   - Base it on challenges relevant to ${company.industry}
   - Avoid overused phrases like "Imagine calling technical support..."

3. **Sections**:
   - Always Create at least 5 (VERY IMPORTANT, ALWAYS 5) distinct main sections that directly address the topic
   - Mention that each section is to be 2 paragraphs long (though we won't store paragraph details here)
   - Sections should logically break down the subject matter in "${titleConcept}"
   - Label them as strings in an array
   - Under each main section, include 2–3 subtopics or talking points

4. **Research Questions**:
   - For each main section, provide 2–3 targeted questions that require factual or data-backed answers
   - Questions should focus on gathering specific data about "${titleConcept}"

5. **Keywords**:
   - Provide a list of SEO keywords or phrases relevant to "${titleConcept}" and ${company.industry}

### Output Format:
Return a valid JSON object **only**, no markdown or extra text. Use these **exact** keys:
{
  "title": string,
  "hook": string,
  "sections": string[],
  "research_questions": {
    "Section 1 Title": string[],
    "Section 2 Title": string[],
    ...
  },
  "keywords": string[]
}

Do not wrap in triple backticks or any code blocks, just the JSON.

Context about the company:
${JSON.stringify(company, null, 2)}
`.trim();

    logger.info('Generated prompt:', prompt);

    try {
      const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
      logger.info('Created Gemini model');

      const timestamp = new Date().toISOString();
      const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 8192,
          candidateCount: 1,
          stopSequences: []
        },
        tools: [{
          functionDeclarations: [{
            name: 'google_search'
          }]
        }],
        safetySettings: []
      });
      logger.info('Generated content from Gemini');

      const response = await result.response;
      let text = response.text();
      logger.info('Raw AI response:', text);

      // Remove markdown code blocks if present
      text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
      logger.info('Cleaned text:', text);

      try {
        const structureData = JSON.parse(text);
        logger.info('Structure generated successfully:', structureData);
        res.json(structureData);
      } catch (parseError) {
        logger.error('Failed to parse AI response as JSON:', text);
        logger.error('Parse error:', parseError);
        res.status(500).json({
          error: 'Failed to generate valid blog structure',
          details: text
        });
      }
    } catch (aiError) {
      logger.error('AI generation error:', aiError);
      res.status(500).json({ 
        error: 'Failed to generate content from AI',
        details: aiError.message
      });
    }
  } catch (error) {
    logger.error('Error in structure generation endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to generate blog post structure',
      details: error.message
    });
  }
});

/**
 * Research factual answers using Gemini (gemini-2.0-flash-exp) with "google_search" tool
 * @route POST /api/generate/facts
 */
app.post('/api/generate/facts', async (req, res) => {
  try {
    logger.info('Researching facts...');
    logger.info('Request body:', JSON.stringify(req.body, null, 2));
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      logger.warn('Invalid questions format:', questions);
      return res.status(400).json({
        error: 'Please provide an array of questions under "questions"'
      });
    }

    logger.info('Processing questions:', JSON.stringify(questions, null, 2));
    const prompt = `
You are a fact-checker and researcher with access to reliable data sources (including real-time Google Search). 
Answer the following questions with accurate, succinct, and well-researched information. 
Provide brief references or stats (e.g., "According to Gartner...") where relevant.

Important: When mentioning currency values, write them as "USD X" instead of using $ symbols.

Return your entire response as valid JSON with key-value pairs:
{
  "Question 1": "Answer about question 1...",
  "Question 2": "Answer about question 2..."
}

Questions:
${questions.join('\n')}

Return no extra text, only the JSON response.
`.trim();

    // Add timestamp to prevent caching
    const timestamp = new Date().toISOString();
    const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
    logger.info('Using prompt:', promptWithTimestamp);

    logger.info('Initializing Gemini model...');
    const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    logger.info('Sending request to Gemini...');
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 8192,
        candidateCount: 1,
        stopSequences: []
      },
      tools: [{
        functionDeclarations: [{
          name: 'google_search'
        }]
      }],
      safetySettings: []
    });

    logger.info('Received response from Gemini');
    const response = await result.response;
    let text = response.text();
    logger.info('Raw response text:', text);

    // Remove markdown code blocks if present
    text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
    text = text.replace(/\$/g, 'USD ');  // Replace $ with USD
    text = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');  // Remove control characters
    logger.info('Cleaned response text:', text);

    try {
      const factsData = JSON.parse(text);
      logger.info('Successfully parsed JSON response');
      res.json(factsData);
    } catch (parseError) {
      logger.error('Failed to parse facts response. Parse error:', parseError);
      logger.error('Problematic text:', text);
      res.status(500).json({
        error: 'Failed to parse facts response',
        details: parseError.message,
        rawText: text
      });
    }
  } catch (error) {
    logger.error('Error researching facts. Full error:', error);
    logger.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to research facts',
      details: error.message,
      stack: error.stack 
    });
  }
});

/**
 * Generate a comprehensive blog post draft using OpenAI (gpt-4o)
 * @route POST /api/generate/article
 */
app.post('/api/generate/article', async (req, res) => {
  try {
    logger.info('Generating article draft...');
    const { structure, facts, tone, style, company } = req.body;

    const prompt = `### Role & Task
You are an expert blog writer creating content for ${company.company_name}, a trusted authority in the ${company.industry} industry. Write from ${company.company_name}'s perspective, sharing expertise while maintaining a helpful, educational tone.

### Voice & Perspective
- Write as ${company.company_name}, sharing our expertise and insights naturally throughout the article
- Present solutions and insights from our perspective as industry experts
- Maintain a subtle but confident tone that demonstrates authority without being pushy
- Let our expertise show through the depth and quality of information we share
- Weave in our understanding of the topic organically throughout the content

### Goals
1. Use the provided structure and factual data to craft a thoroughly informative and engaging blog post
2. Avoid overused intros like "Picture this" or "Imagine that"
3. Write in a tone described as: ${tone}
4. Use a style described as: ${style}
5. Position ${company.company_name} as a knowledgeable guide through this topic

### Content Instructions
1. **Opening**:
   - Start with the hook provided in the structure JSON
   - Establish our authority on the subject naturally
   - Keep it dynamic and succinct

2. **Main Sections**:
   - For each section from the structure, expand on the subtopics
   - Each main section should contain 2 paragraphs, each with 3–6 sentences
   - Weave in the factual data from the "facts" JSON, citing sources where relevant
   - Share insights that demonstrate our practical experience with these solutions
   - Let our expertise emerge through the depth of understanding we share

3. **Depth & Value**:
   - Provide substantive, actionable insights that showcase our experience
   - Include practical details that demonstrate our hands-on expertise
   - Reference the facts JSON for data points, integrating them naturally
   - Share real-world perspectives that only an experienced provider would know

4. **Conclusion**:
   - Summarize the key insights in a way that reinforces our expertise
   - End with a natural transition to our call-to-action
   - Conclude with our tagline: "${company.tagline}"

### Output Requirements
- Create a single cohesive blog post in **markdown** format (no JSON)
- Use headings and subheadings (##, ###, etc.) that map to the structure's sections
- Maintain a helpful, educational tone throughout
- Let our authority emerge naturally through expertise rather than explicit statements
- Focus on providing value while subtly demonstrating our capability to implement these solutions

### Provided Data
**Structure**:
${JSON.stringify(structure, null, 2)}

**Facts**:
${JSON.stringify(facts, null, 2)}

Begin now.`.trim();

    // Add timestamp to prevent caching
    const timestamp = new Date().toISOString();
    const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;

    const completion = await openAIClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: promptWithTimestamp }],
      max_tokens: 8192,
      temperature: 0.7
    });

    const text = completion.choices[0].message.content;
    logger.info('Article draft generated successfully');
    res.json({ content: text });
  } catch (error) {
    logger.error('Error generating article:', error);
    res.status(500).json({ error: 'Failed to generate article' });
  }
});

/**
 * NEW STEP: Verify the final draft for factual correctness using Gemini again or a specialized prompt
 * @route POST /api/generate/verify
 */
app.post('/api/generate/verify', async (req, res) => {
  try {
    logger.info('Verifying factual accuracy of draft...');
    const { draft } = req.body; // the entire blog post draft in plain text/markdown

    if (!draft) {
      return res.status(400).json({
        error: 'Please provide a "draft" field with the blog post text.'
      });
    }

    // Example prompt to check the entire draft and highlight inaccuracies
    // The model should return a JSON listing sections that are suspect, recommended corrections, and any references
    const prompt = `
You are a highly detailed fact checker with access to real-time Google Search. 
Read the entire blog post draft below and identify any statements that appear unverified, exaggerated, or incorrect 
based on your up-to-date knowledge. Provide the correct facts or references where available.

Return your response as valid JSON with the following structure:
{
  "flagged_inaccuracies": [
    {
      "original_text": "The text that might be wrong",
      "reason": "Why it's wrong or suspicious",
      "corrected_text": "What it should be replaced with (if known)",
      "references": ["Any reference or link used"]
    },
    ...
  ]
}

Draft to verify:
${draft}

Only return the JSON response, nothing else.
`.trim();

    const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 8192,
        candidateCount: 1,
        stopSequences: []
      },
      tools: [{
        functionDeclarations: [{
          name: 'google_search'
        }]
      }],
      safetySettings: []
    });

    const response = await result.response;
    let text = response.text();

    // Remove any code fencing
    text = text.replace(/```json\n/, '').replace(/```/g, '').trim();

    try {
      const verifyData = JSON.parse(text);
      logger.info('Draft verified successfully:', verifyData);
      res.json(verifyData);
    } catch (parseError) {
      logger.error('Failed to parse verification response:', text);
      res.status(500).json({
        error: 'Failed to generate valid verification response',
        details: text
      });
    }
  } catch (error) {
    logger.error('Error verifying article:', error);
    res.status(500).json({ error: 'Failed to verify article' });
  }
});

/**
 * Polish content using Anthropic Claude (claude-3-5-sonnet-20241022)
 * @route POST /api/generate/polish
 */
app.post('/api/generate/polish', async (req, res) => {
  try {
    logger.info('Polishing article...');
    const { content, corrections } = req.body; 
    // `content` is the original draft,
    // `corrections` is the JSON from the verify step with any flagged inaccuracies

    // Updated prompt that merges content + factual corrections
    const prompt = `You are an expert content editor and writer polishing a blog post written from the company's perspective as an industry authority.

### Important Guidelines
1. PRESERVE the company's voice and authority - do not tone down or remove company expertise and capabilities
2. Maintain the company's position as a trusted expert in their field
3. Keep all company-specific information, experience claims, and solutions intact
4. Focus on enhancing clarity and readability while preserving the company's authority

### Polishing Steps
EXTREMELY IMPORTANT NOTE: You must write this article in a very human-like tone that is both approachable and engaging while also a confident trusted authority. Your copy should be narrative in nature similar to Donald Miller's writing, you understand that humans enjoy stories and so whenever possible, you use storytelling and narrative direction to get messages and points across, but it's clear what you're discussing, why it should matter to the customer and ultimately what question it is answering for them. You have a bit of the fun edge of "Gary V" and "Alex Hormozi" but it's clear you know your target audience is B2B, mainly enterprise and on linkedin so you write brilliantly and accordingly to these specifications.
1. Identify and preserve the core message, key facts, and company expertise
2. Improve clarity, flow, and engagement
3. Remove any redundant phrases or overused intros
4. Strengthen transitions between sections
5. Preserve company perspective and industry authority
6. Use a professional yet approachable tone
7. Keep examples that demonstrate company expertise
8. **Incorporate factual corrections** based on the "corrections" data, BUT:
   - Do not remove or tone down company expertise claims
   - Only modify industry statistics or third-party claims
   - Preserve the company's voice and authority

Below is the blog post draft to polish:
<blog_post_draft>
${content}
</blog_post_draft>

Below is the list of flagged inaccuracies and recommended fixes:
<corrections>
${JSON.stringify(corrections, null, 2)}
</corrections>

### Your Task
- For each flagged inaccuracy in the corrections, carefully evaluate:
  1. If it's about general industry statistics or third-party claims: replace with corrected text
  2. If it's about company expertise or capabilities: preserve the original message while improving clarity
- Maintain the company's authoritative voice throughout
- Keep all company-specific information and expertise claims
- Focus on enhancing readability while preserving the company's position as an industry expert
- Wrap your analysis in <analysis>...</analysis> tags. Summarize major changes or improvements you made.
- Then output the polished blog post in the format:

<polished_blog_post>
  <title>[Title here]</title>
  <body>
  [Main content here in paragraphs]
  </body>
</polished_blog_post>
`.trim();

    // Log the complete prompt
    logger.info('Complete polishing prompt:', prompt);

    const message = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    });

    logger.info('Article polished successfully');
    res.json({ content: message.content[0].text });
  } catch (error) {
    logger.error('Error polishing article:', error);
    res.status(500).json({ error: 'Failed to polish article' });
  }
});

/**
 * Convert Markdown content to SEO-optimized HTML using OpenAI (gpt-4o)
 * @route POST /api/generate/html
 */
app.post('/api/generate/html', async (req, res) => {
  try {
    logger.info('Converting Markdown to HTML...');
    const { content, metadata } = req.body;

  const prompt = `
You are an expert at converting Markdown to SEO-optimized HTML.
Use proper semantic tags (h1, h2, etc.), include meta tags, and incorporate relevant keywords.
Ensure the final HTML is clean, valid, and well-structured.

---
Title: ${metadata.title}
Keywords: ${metadata.keywords.join(', ')}
---
Markdown Content:
${content}

Requirements:
- Use an <h1> tag for the title.
- Use <meta name="keywords" content="..."> for the keywords.
- Provide a <meta name="description" content="A concise, compelling description of the article"> (you may generate one).
- Retain headings as <h2>, <h3> if provided in the Markdown.
- Turn bullet points, lists, images, or links into valid HTML as needed.
- Return only the final HTML (no JSON).
`.trim();

    const timestamp = new Date().toISOString();
    const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;

    const completion = await openAIClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: promptWithTimestamp }]
    });

    const text = completion.choices[0].message.content;
    logger.info('HTML generated successfully');
    res.json({ html: text });
  } catch (error) {
    logger.error('Error generating HTML:', error);
    res.status(500).json({ error: 'Failed to generate HTML' });
  }
});

/**
 * Save blog post to database
 * @route POST /api/posts
 */
app.post('/api/posts', async (req, res) => {
  try {
    logger.info('Saving blog post to database...');
    const {
      user_id,
      company_id,
      title_concept,
      structure,
      facts,
      article,
      polished,
      final_html,
    } = req.body;

    // Create metadata object from available data
    const metadata = {
      title: structure?.title,
      keywords: structure?.keywords || [],
      sections: structure?.sections || [],
      research_questions: structure?.research_questions || {},
      facts: facts || {}
    };

    const { data, error } = await supabase
      .from('blog_posts')
      .insert([
        {
          user_id,
          company_id,
          title_concept,
          structure,
          facts,
          article,
          polished,
          final_html,
          metadata,
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) throw error;

    logger.info('Blog post saved successfully');
    res.json(data[0]);
  } catch (error) {
    logger.error('Error saving blog post:', error);
    res.status(500).json({ error: 'Failed to save blog post' });
  }
});

/**
 * Get all blog posts
 * @route GET /api/posts
 */
app.get('/api/posts', async (req, res) => {
  try {
    logger.info('Fetching all blog posts...');
    
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching posts:', error);
      throw error;
    }

    logger.info('Blog posts fetched successfully');
    res.json(data);
  } catch (error) {
    logger.error('Error fetching blog posts:', error);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

/**
 * Get single blog post by ID
 * @route GET /api/posts/:id
 */
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Fetching blog post with ID: ${id}`);
    
    const { data: existingPost, error: fetchError } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('id', id)
      .maybeSingle();  // Use maybeSingle() instead of single() to avoid errors

    if (fetchError) {
      logger.error('Error fetching post:', fetchError);
      throw fetchError;
    }

    if (!existingPost) {
      logger.error('Post not found:', id);
      throw new Error(`Post with ID ${id} not found`);
    }

    logger.info('Blog post fetched successfully');
    res.json(existingPost);
  } catch (error) {
    logger.error('Error fetching blog post:', error);
    res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

/**
 * Generate social media posts for a blog post
 * @route POST /api/posts/:id/social
 */
app.post('/api/posts/:id/social', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    logger.info(`Generating social media posts for blog post ${id}...`);
    logger.info('Content length:', content.length);
    
    // System prompt for GPT-4o
    const systemPrompt = `You are a social media expert. Your task is to create engaging social media posts based on the provided article content.
IMPORTANT: Your response must be a valid JSON object exactly matching this structure, with no additional text or markdown formatting:
{
  "Instagram": {
    "content": "Your Instagram post content here",
    "hashtags": ["hashtag1", "hashtag2"]
  },
  "Facebook": {
    "content": "Your Facebook post content here",
    "link": "https://example.com"
  },
  "X": {
    "content": "Your X post content here",
    "hashtags": ["hashtag1", "hashtag2"]
  },
  "LinkedIn": {
    "content": "Your LinkedIn post content here",
    "link": "https://example.com"
  }
}

Guidelines:
1. Response MUST be valid JSON
2. Keep Instagram and X posts concise
3. Include relevant hashtags
4. Maintain the article's tone
5. Include emojis where appropriate
6. DO NOT include any text outside the JSON structure`;

    try {
      // Call GPT-4o
      const completion = await openAIClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        temperature: 0.7,
      });

      logger.info('GPT response received');
      
      const rawContent = completion.choices[0].message.content;
      logger.info('Raw GPT response:', rawContent);

      let socialPosts;
      try {
        logger.info('Attempting to parse GPT response...');
        // Try to parse the JSON response
        socialPosts = JSON.parse(rawContent.trim());
        logger.info('Successfully parsed social posts:', JSON.stringify(socialPosts, null, 2));
      } catch (parseError) {
        logger.error('Error parsing GPT response:', parseError);
        logger.error('Raw content that failed to parse:', rawContent);
        throw new Error(`Failed to parse GPT response: ${parseError.message}`);
      }

      // First, fetch the existing post
      logger.info('Searching for post with ID:', id);
      const query = supabase
        .from('blog_posts')
        .select('*')
        .eq('id', id)
        .maybeSingle();  // Use maybeSingle() instead of single() to avoid errors

      // Log the query details
      logger.info('Query details:', {
        table: 'blog_posts',
        id: id,
        supabaseUrl: supabaseUrl,
      });

      const { data: existingPost, error: fetchError } = await query;

      logger.info('Database query result:', { 
        data: existingPost, 
        error: fetchError,
        found: existingPost !== null
      });

      if (fetchError) {
        logger.error('Error fetching post:', fetchError);
        throw fetchError;
      }

      if (!existingPost) {
        logger.error('Post not found in database. ID:', id);
        // Let's also check what posts do exist
        const { data: allPosts, error: listError } = await supabase
          .from('blog_posts')
          .select('id')
          .limit(5);
        
        if (!listError) {
          logger.info('First 5 posts in database:', allPosts);
        }
        throw new Error(`Post with ID ${id} not found`);
      }

      logger.info('Found existing post:', existingPost.id);

      // Now update just the social media fields
      const { error: updateError } = await supabase
        .from('blog_posts')
        .update({
          instagram_post_content: socialPosts.Instagram.content,
          instagram_hashtags: socialPosts.Instagram.hashtags,
          facebook_post_content: socialPosts.Facebook.content,
          facebook_post_link: socialPosts.Facebook.link,
          x_post_content: socialPosts.X.content,
          x_hashtags: socialPosts.X.hashtags,
          linkedin_post_content: socialPosts.LinkedIn.content,
          linkedin_post_link: socialPosts.LinkedIn.link,
          social_posts_generated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) throw updateError;

      logger.info('Successfully updated blog post with social content');
      res.json(socialPosts);
    } catch (error) {
      logger.error('Error generating social media posts:', error);
      res.status(500).json({ error: 'Failed to generate social media posts' });
    }
  } catch (error) {
    logger.error('Error in social media generation:', error);
    res.status(500).json({ error: 'Failed to generate social media posts' });
  }
});

/**
 * Generate email drip campaign for a blog post
 * @route POST /api/posts/:id/email-campaign
 */
app.post('/api/posts/:id/email-campaign', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    logger.info(`Generating email campaign for blog post ${id}...`);
    logger.info('Content length:', content.length);

    // Generate email campaign using Gemini
    const prompt = `You are an expert B2B email marketing campaign writer with 15 years of experience. You always write 4 drips, each drip is engaging, informing, and opens up with a question that addresses the main content's painpoint(s). You'll return the email campaign in JSON format including a subject line and email content for each of the 4 drips. The email campaigns focus should be based entirely on the content below. Each email should continue from the next, for example - email 2 should include a reference to the first ie. "I wanted to follow up on the last email I sent you." The emails should be empathetic with a tone that the writer cares about the reader and doesn't want them to miss out on the content. The last email should be "This will be my final email regarding...." but always include something like "I'd still love to connect with you, how is your calendar looking next week?"

Here's the blog article to base the campaign on:
${content}

Return ONLY the JSON in this exact format, with no other text:
{
  "drips": [
    {
      "subject": "Email 1 Subject",
      "content": "Email 1 Content"
    },
    {
      "subject": "Email 2 Subject",
      "content": "Email 2 Content"
    },
    {
      "subject": "Email 3 Subject",
      "content": "Email 3 Content"
    },
    {
      "subject": "Email 4 Subject",
      "content": "Email 4 Content"
    }
  ]
}`;

    // Log full content and prompt separately for clarity
    logger.info('BLOG CONTENT BEING USED:');
    logger.info('----------------------------------------');
    logger.info(content);
    logger.info('----------------------------------------');
    
    logger.info('FULL PROMPT TO GEMINI:');
    logger.info('----------------------------------------');
    logger.info(prompt);
    logger.info('----------------------------------------');

    const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    logger.info('Created Gemini model for email campaign');

    const timestamp = new Date().toISOString();
    const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;

    logger.info('Sending request to Gemini with config:', {
      model: 'gemini-2.0-flash-exp',
      temperature: 0.9,
      maxOutputTokens: 8192,
      timestamp
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 8192,
        candidateCount: 1,
        stopSequences: []
      },
      tools: [{
        functionDeclarations: [{
          name: 'google_search'
        }]
      }],
      safetySettings: []
    });
    logger.info('Generated content from Gemini');

    const response = await result.response;
    let text = response.text();
    logger.info('Raw response from Gemini:', {
      responseLength: text.length,
      responsePreview: text.substring(0, 500) + '...'
    });

    // Remove markdown code blocks if present
    text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
    logger.info('Cleaned response text:', {
      cleanedLength: text.length,
      cleanedPreview: text.substring(0, 500) + '...'
    });

    // Parse the response
    let emailCampaign;
    try {
      emailCampaign = JSON.parse(text);
      logger.info('Successfully parsed JSON response:', {
        numberOfDrips: emailCampaign.drips?.length,
        firstDripSubject: emailCampaign.drips?.[0]?.subject,
        structure: JSON.stringify(emailCampaign, null, 2)
      });
    } catch (parseError) {
      logger.error('Failed to parse AI response as JSON:', {
        text,
        error: parseError.message
      });
      throw new Error(`Failed to parse Gemini response: ${parseError.message}`);
    }

    // Add generated timestamp
    emailCampaign.generated_at = new Date().toISOString();

    // Update the post with the email campaign
    logger.info('Updating blog post with generated email campaign...');
    const { error: updateError } = await supabase
      .from('blog_posts')
      .update({
        email_drip_campaigns: emailCampaign
      })
      .eq('id', id);

    if (updateError) {
      logger.error('Error updating post with email campaign:', updateError);
      throw updateError;
    }

    logger.info('Successfully generated and saved email campaign');
    res.json(emailCampaign);
  } catch (error) {
    logger.error('Error in email campaign generation:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Failed to generate email campaign', 
      details: error.message 
    });
  }
});

/**
 * Debug route to check database contents
 * @route GET /debug/posts
 */
app.get('/debug/posts', async (req, res) => {
  try {
    logger.info('Debug: Fetching all blog posts...');
    
    const { data, error } = await supabase
      .from('blog_posts')
      .select('id, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Debug: Error fetching posts:', error);
      throw error;
    }

    logger.info('Debug: Found posts:', JSON.stringify(data, null, 2));
    res.json({
      count: data.length,
      posts: data,
      supabaseUrl: supabaseUrl // Log the URL we're connected to
    });
  } catch (error) {
    logger.error('Debug: Error in debug route:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Fallback error handling
 */
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start the server
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});