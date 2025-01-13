```
Project Structure:
├── README.md
├── codefetch
├── logger.js
├── package-lock.json
├── package.json
├── server.js
├── server.ts
├── start.sh
└── stripe.js
```

logger.js
```
1 | import fs from 'fs';
2 | import path from 'path';
3 | import { fileURLToPath } from 'url';
4 | 
5 | const __dirname = path.dirname(fileURLToPath(import.meta.url));
6 | const LOG_DIR = path.join(__dirname, '../logs');
7 | const API_LOG_FILE = path.join(LOG_DIR, 'api.log');
8 | 
9 | // Create logs directory if it doesn't exist
10 | if (!fs.existsSync(LOG_DIR)) {
11 |   fs.mkdirSync(LOG_DIR);
12 | }
13 | 
14 | // Format the log message with timestamp
15 | const formatLogMessage = (type, message) => {
16 |   const timestamp = new Date().toISOString();
17 |   return `[${timestamp}] [${type}] ${typeof message === 'object' ? JSON.stringify(message, null, 2) : message}\n`;
18 | };
19 | 
20 | // Write to log file
21 | const writeToLog = (message) => {
22 |   fs.appendFileSync(API_LOG_FILE, message);
23 | };
24 | 
25 | // Log levels
26 | export const logger = {
27 |   info: (message) => {
28 |     const logMessage = formatLogMessage('INFO', message);
29 |     console.log(logMessage);
30 |     writeToLog(logMessage);
31 |   },
32 |   error: (message, error) => {
33 |     const logMessage = formatLogMessage('ERROR', {
34 |       message,
35 |       error: error?.message || error,
36 |       stack: error?.stack
37 |     });
38 |     console.error(logMessage);
39 |     writeToLog(logMessage);
40 |   },
41 |   request: (req) => {
42 |     const logMessage = formatLogMessage('REQUEST', {
43 |       method: req.method,
44 |       path: req.path,
45 |       query: req.query,
46 |       body: req.body,
47 |       headers: {
48 |         'content-type': req.headers['content-type'],
49 |         'user-agent': req.headers['user-agent']
50 |       }
51 |     });
52 |     writeToLog(logMessage);
53 |   },
54 |   response: (req, res, data) => {
55 |     const logMessage = formatLogMessage('RESPONSE', {
56 |       method: req.method,
57 |       path: req.path,
58 |       statusCode: res.statusCode,
59 |       data: data
60 |     });
61 |     writeToLog(logMessage);
62 |   }
63 | };
64 | 
65 | // Express middleware to log requests and responses
66 | export const requestLogger = (req, res, next) => {
67 |   logger.request(req);
68 | 
69 |   // Capture the original res.json to log responses
70 |   const originalJson = res.json;
71 |   res.json = function(data) {
72 |     logger.response(req, res, data);
73 |     return originalJson.call(this, data);
74 |   };
75 | 
76 |   next();
77 | };
```

package.json
```
1 | {
2 |   "name": "blogcraft-api",
3 |   "version": "1.0.0",
4 |   "type": "module",
5 |   "main": "server.js",
6 |   "scripts": {
7 |     "start": "node server.js",
8 |     "dev": "node server.js"
9 |   },
10 |   "dependencies": {
11 |     "@anthropic-ai/sdk": "^0.33.1",
12 |     "@google/generative-ai": "^0.21.0",
13 |     "@supabase/supabase-js": "2.39.7",
14 |     "cors": "2.8.5",
15 |     "dotenv": "^16.4.1",
16 |     "express": "4.18.3",
17 |     "openai": "^4.77.3",
18 |     "stripe": "^17.5.0",
19 |     "winston": "^3.11.0"
20 |   },
21 |   "engines": {
22 |     "node": ">=18.0.0"
23 |   }
24 | }
```

server.js
```
1 | /***************************************************
2 |  * server.js (Revised)
3 |  ***************************************************/
4 | import 'dotenv/config';
5 | import express from 'express';
6 | import cors from 'cors';
7 | import { createClient } from '@supabase/supabase-js';
8 | import OpenAI from 'openai';
9 | import Anthropic from '@anthropic-ai/sdk';
10 | // IMPORTANT: Use a namespace import for @google/generative-ai
11 | import * as generativeAi from '@google/generative-ai';
12 | import { logger, requestLogger } from './logger.js';
13 | import { createCheckoutSession, handleStripeWebhook } from './stripe.js';
14 | 
15 | // Extract classes from the namespace
16 | const { GoogleGenerativeAI } = generativeAi;
17 | 
18 | const app = express();
19 | 
20 | // Stripe webhook needs raw body
21 | app.post('/api/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
22 | 
23 | // Configure CORS with specific options
24 | app.use(cors({
25 |   origin: [
26 |     'https://growthcraft.netlify.app',
27 |     'http://localhost:5173', // For local development
28 |   ],
29 |   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
30 |   allowedHeaders: ['Content-Type', 'Authorization'],
31 |   credentials: true
32 | }));
33 | 
34 | app.use(express.json());
35 | app.use(requestLogger);
36 | 
37 | // Add Stripe endpoint
38 | app.post('/api/create-checkout-session', createCheckoutSession);
39 | 
40 | // ------------------------------------------------------------------
41 | // 1. Initialize AI clients
42 | // ------------------------------------------------------------------
43 | const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
44 | if (!apiKey) {
45 |   logger.error('Missing Google PaLM / Gemini API Key. Set GOOGLE_API_KEY or GEMINI_API_KEY in your .env');
46 |   process.exit(1);
47 | }
48 | const googleClient = new GoogleGenerativeAI(apiKey);
49 | const openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
50 | const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
51 | 
52 | // Initialize Supabase
53 | const supabaseUrl = process.env.VITE_SUPABASE_URL;
54 | const supabaseKey = process.env.SUPABASE_SERVICE_KEY;  // Use service role key to bypass RLS
55 | 
56 | logger.info('Initializing Supabase with service role...');
57 | const supabase = createClient(supabaseUrl, supabaseKey);
58 | 
59 | // ------------------------------------------------------------------
60 | // 2. Define routes
61 | // ------------------------------------------------------------------
62 | 
63 | /**
64 |  * Generate a blog post structure using Gemini (gemini-2.0-flash-exp)
65 |  * @route POST /api/generate/structure
66 |  */
67 | app.post('/api/generate/structure', async (req, res) => {
68 |   try {
69 |     logger.info('Generating blog post structure...');
70 |     const { titleConcept, company } = req.body;
71 | 
72 |     logger.info('Received request data:', { titleConcept, company });
73 | 
74 |     if (!titleConcept || !company) {
75 |       logger.error('Missing required fields:', { titleConcept, company });
76 |       return res.status(400).json({ error: 'Missing required fields' });
77 |     }
78 | 
79 |     if (!company.company_name || !company.industry || !company.tagline) {
80 |       logger.error('Missing company fields:', company);
81 |       return res.status(400).json({ error: 'Missing company information' });
82 |     }
83 | 
84 |     logger.info('Request data validated successfully');
85 | 
86 |     // <-- CHANGED: Prompt updated to require 5 sections
87 |     const prompt = `
88 | ### Role
89 | You are a specialized content strategist creating a blog post structure about: "${titleConcept}"
90 | 
91 | ### Requirements:
92 | 
93 | 1. **Title**:
94 |    - Create a title that closely matches the given topic: "${titleConcept}"
95 |    - Make it SEO-optimized, catchy, yet factual
96 |    - Avoid cliche phrases like "Picture this" or "Imagine that"
97 | 
98 | 2. **Hook**:
99 |    - Write 1–2 sentences that immediately grab the reader's attention
100 |    - Focus on the specific pain points or opportunities mentioned in "${titleConcept}"
101 |    - Base it on challenges relevant to ${company.industry}
102 |    - Avoid overused phrases like "Imagine calling technical support..."
103 | 
104 | 3. **Sections**:
105 |    - Always Create at least 5 (VERY IMPORTANT, ALWAYS 5) distinct main sections that directly address the topic
106 |    - Mention that each section is to be 2 paragraphs long (though we won't store paragraph details here)
107 |    - Sections should logically break down the subject matter in "${titleConcept}"
108 |    - Label them as strings in an array
109 |    - Under each main section, include 2–3 subtopics or talking points
110 | 
111 | 4. **Research Questions**:
112 |    - For each main section, provide 2–3 targeted questions that require factual or data-backed answers
113 |    - Questions should focus on gathering specific data about "${titleConcept}"
114 | 
115 | 5. **Keywords**:
116 |    - Provide a list of SEO keywords or phrases relevant to "${titleConcept}" and ${company.industry}
117 | 
118 | ### Output Format:
119 | Return a valid JSON object **only**, no markdown or extra text. Use these **exact** keys:
120 | {
121 |   "title": string,
122 |   "hook": string,
123 |   "sections": string[],
124 |   "research_questions": {
125 |     "Section 1 Title": string[],
126 |     "Section 2 Title": string[],
127 |     ...
128 |   },
129 |   "keywords": string[]
130 | }
131 | 
132 | Do not wrap in triple backticks or any code blocks, just the JSON.
133 | 
134 | Context about the company:
135 | ${JSON.stringify(company, null, 2)}
136 | `.trim();
137 | 
138 |     logger.info('Generated prompt:', prompt);
139 | 
140 |     try {
141 |       const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
142 |       logger.info('Created Gemini model');
143 | 
144 |       const timestamp = new Date().toISOString();
145 |       const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
146 | 
147 |       const result = await model.generateContent({
148 |         contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
149 |         generationConfig: {
150 |           temperature: 0.9,
151 |           maxOutputTokens: 8192,
152 |           candidateCount: 1,
153 |           stopSequences: []
154 |         },
155 |         tools: [{
156 |           functionDeclarations: [{
157 |             name: 'google_search'
158 |           }]
159 |         }],
160 |         safetySettings: []
161 |       });
162 |       logger.info('Generated content from Gemini');
163 | 
164 |       const response = await result.response;
165 |       let text = response.text();
166 |       logger.info('Raw AI response:', text);
167 | 
168 |       // Remove markdown code blocks if present
169 |       text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
170 |       logger.info('Cleaned text:', text);
171 | 
172 |       try {
173 |         const structureData = JSON.parse(text);
174 |         logger.info('Structure generated successfully:', structureData);
175 |         res.json(structureData);
176 |       } catch (parseError) {
177 |         logger.error('Failed to parse AI response as JSON:', text);
178 |         logger.error('Parse error:', parseError);
179 |         res.status(500).json({
180 |           error: 'Failed to generate valid blog structure',
181 |           details: text
182 |         });
183 |       }
184 |     } catch (aiError) {
185 |       logger.error('AI generation error:', aiError);
186 |       res.status(500).json({ 
187 |         error: 'Failed to generate content from AI',
188 |         details: aiError.message
189 |       });
190 |     }
191 |   } catch (error) {
192 |     logger.error('Error in structure generation endpoint:', error);
193 |     res.status(500).json({ 
194 |       error: 'Failed to generate blog post structure',
195 |       details: error.message
196 |     });
197 |   }
198 | });
199 | 
200 | /**
201 |  * Research factual answers using Gemini (gemini-2.0-flash-exp) with "google_search" tool
202 |  * @route POST /api/generate/facts
203 |  */
204 | app.post('/api/generate/facts', async (req, res) => {
205 |   try {
206 |     logger.info('Researching facts...');
207 |     logger.info('Request body:', JSON.stringify(req.body, null, 2));
208 |     const { questions } = req.body;
209 | 
210 |     if (!Array.isArray(questions) || questions.length === 0) {
211 |       logger.warn('Invalid questions format:', questions);
212 |       return res.status(400).json({
213 |         error: 'Please provide an array of questions under "questions"'
214 |       });
215 |     }
216 | 
217 |     logger.info('Processing questions:', JSON.stringify(questions, null, 2));
218 |     const prompt = `
219 | You are a fact-checker and researcher with access to reliable data sources (including real-time Google Search). 
220 | Answer the following questions with accurate, succinct, and well-researched information. 
221 | Provide brief references or stats (e.g., "According to Gartner...") where relevant.
222 | 
223 | Important: When mentioning currency values, write them as "USD X" instead of using $ symbols.
224 | 
225 | Return your entire response as valid JSON with key-value pairs:
226 | {
227 |   "Question 1": "Answer about question 1...",
228 |   "Question 2": "Answer about question 2..."
229 | }
230 | 
231 | Questions:
232 | ${questions.join('\n')}
233 | 
234 | Return no extra text, only the JSON response.
235 | `.trim();
236 | 
237 |     // Add timestamp to prevent caching
238 |     const timestamp = new Date().toISOString();
239 |     const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
240 |     logger.info('Using prompt:', promptWithTimestamp);
241 | 
242 |     logger.info('Initializing Gemini model...');
243 |     const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
244 |     
245 |     logger.info('Sending request to Gemini...');
246 |     const result = await model.generateContent({
247 |       contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
248 |       generationConfig: {
249 |         temperature: 0.9,
250 |         maxOutputTokens: 8192,
251 |         candidateCount: 1,
252 |         stopSequences: []
253 |       },
254 |       tools: [{
255 |         functionDeclarations: [{
256 |           name: 'google_search'
257 |         }]
258 |       }],
259 |       safetySettings: []
260 |     });
261 | 
262 |     logger.info('Received response from Gemini');
263 |     const response = await result.response;
264 |     let text = response.text();
265 |     logger.info('Raw response text:', text);
266 | 
267 |     // Remove markdown code blocks if present
268 |     text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
269 |     text = text.replace(/\$/g, 'USD ');  // Replace $ with USD
270 |     text = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');  // Remove control characters
271 |     logger.info('Cleaned response text:', text);
272 | 
273 |     try {
274 |       const factsData = JSON.parse(text);
275 |       logger.info('Successfully parsed JSON response');
276 |       res.json(factsData);
277 |     } catch (parseError) {
278 |       logger.error('Failed to parse facts response. Parse error:', parseError);
279 |       logger.error('Problematic text:', text);
280 |       res.status(500).json({
281 |         error: 'Failed to parse facts response',
282 |         details: parseError.message,
283 |         rawText: text
284 |       });
285 |     }
286 |   } catch (error) {
287 |     logger.error('Error researching facts. Full error:', error);
288 |     logger.error('Error stack:', error.stack);
289 |     res.status(500).json({ 
290 |       error: 'Failed to research facts',
291 |       details: error.message,
292 |       stack: error.stack 
293 |     });
294 |   }
295 | });
296 | 
297 | /**
298 |  * Generate a comprehensive blog post draft using OpenAI (gpt-4o)
299 |  * @route POST /api/generate/article
300 |  */
301 | app.post('/api/generate/article', async (req, res) => {
302 |   try {
303 |     logger.info('Generating article draft...');
304 |     const { structure, facts, tone, style, company } = req.body;
305 | 
306 |     const prompt = `### Role & Task
307 | You are an expert blog writer creating content for ${company.company_name}, a trusted authority in the ${company.industry} industry. Write from ${company.company_name}'s perspective, sharing expertise while maintaining a helpful, educational tone.
308 | 
309 | ### Voice & Perspective
310 | - Write as ${company.company_name}, sharing our expertise and insights naturally throughout the article
311 | - Present solutions and insights from our perspective as industry experts
312 | - Maintain a subtle but confident tone that demonstrates authority without being pushy
313 | - Let our expertise show through the depth and quality of information we share
314 | - Weave in our understanding of the topic organically throughout the content
315 | 
316 | ### Goals
317 | 1. Use the provided structure and factual data to craft a thoroughly informative and engaging blog post
318 | 2. Avoid overused intros like "Picture this" or "Imagine that"
319 | 3. Write in a tone described as: ${tone}
320 | 4. Use a style described as: ${style}
321 | 5. Position ${company.company_name} as a knowledgeable guide through this topic
322 | 
323 | ### Content Instructions
324 | 1. **Opening**:
325 |    - Start with the hook provided in the structure JSON
326 |    - Establish our authority on the subject naturally
327 |    - Keep it dynamic and succinct
328 | 
329 | 2. **Main Sections**:
330 |    - For each section from the structure, expand on the subtopics
331 |    - Each main section should contain 2 paragraphs, each with 3–6 sentences
332 |    - Weave in the factual data from the "facts" JSON, citing sources where relevant
333 |    - Share insights that demonstrate our practical experience with these solutions
334 |    - Let our expertise emerge through the depth of understanding we share
335 | 
336 | 3. **Depth & Value**:
337 |    - Provide substantive, actionable insights that showcase our experience
338 |    - Include practical details that demonstrate our hands-on expertise
339 |    - Reference the facts JSON for data points, integrating them naturally
340 |    - Share real-world perspectives that only an experienced provider would know
341 | 
342 | 4. **Conclusion**:
343 |    - Summarize the key insights in a way that reinforces our expertise
344 |    - End with a natural transition to our call-to-action
345 |    - Conclude with our tagline: "${company.tagline}"
346 | 
347 | ### Output Requirements
348 | - Create a single cohesive blog post in **markdown** format (no JSON)
349 | - Use headings and subheadings (##, ###, etc.) that map to the structure's sections
350 | - Maintain a helpful, educational tone throughout
351 | - Let our authority emerge naturally through expertise rather than explicit statements
352 | - Focus on providing value while subtly demonstrating our capability to implement these solutions
353 | 
354 | ### Provided Data
355 | **Structure**:
356 | ${JSON.stringify(structure, null, 2)}
357 | 
358 | **Facts**:
359 | ${JSON.stringify(facts, null, 2)}
360 | 
361 | Begin now.`.trim();
362 | 
363 |     // Add timestamp to prevent caching
364 |     const timestamp = new Date().toISOString();
365 |     const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
366 | 
367 |     const completion = await openAIClient.chat.completions.create({
368 |       model: 'gpt-4o',
369 |       messages: [{ role: 'user', content: promptWithTimestamp }],
370 |       max_tokens: 8192,
371 |       temperature: 0.7
372 |     });
373 | 
374 |     const text = completion.choices[0].message.content;
375 |     logger.info('Article draft generated successfully');
376 |     res.json({ content: text });
377 |   } catch (error) {
378 |     logger.error('Error generating article:', error);
379 |     res.status(500).json({ error: 'Failed to generate article' });
380 |   }
381 | });
382 | 
383 | /**
384 |  * NEW STEP: Verify the final draft for factual correctness using Gemini again or a specialized prompt
385 |  * @route POST /api/generate/verify
386 |  */
387 | app.post('/api/generate/verify', async (req, res) => {
388 |   try {
389 |     logger.info('Verifying factual accuracy of draft...');
390 |     const { draft } = req.body; // the entire blog post draft in plain text/markdown
391 | 
392 |     if (!draft) {
393 |       return res.status(400).json({
394 |         error: 'Please provide a "draft" field with the blog post text.'
395 |       });
396 |     }
397 | 
398 |     // Example prompt to check the entire draft and highlight inaccuracies
399 |     // The model should return a JSON listing sections that are suspect, recommended corrections, and any references
400 |     const prompt = `
401 | You are a highly detailed fact checker with access to real-time Google Search. 
402 | Read the entire blog post draft below and identify any statements that appear unverified, exaggerated, or incorrect 
403 | based on your up-to-date knowledge. Provide the correct facts or references where available.
404 | 
405 | Return your response as valid JSON with the following structure:
406 | {
407 |   "flagged_inaccuracies": [
408 |     {
409 |       "original_text": "The text that might be wrong",
410 |       "reason": "Why it's wrong or suspicious",
411 |       "corrected_text": "What it should be replaced with (if known)",
412 |       "references": ["Any reference or link used"]
413 |     },
414 |     ...
415 |   ]
416 | }
417 | 
418 | Draft to verify:
419 | ${draft}
420 | 
421 | Only return the JSON response, nothing else.
422 | `.trim();
423 | 
424 |     const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
425 | 
426 |     const result = await model.generateContent({
427 |       contents: [{ role: 'user', parts: [{ text: prompt }] }],
428 |       generationConfig: {
429 |         temperature: 0.0,
430 |         maxOutputTokens: 8192,
431 |         candidateCount: 1,
432 |         stopSequences: []
433 |       },
434 |       tools: [{
435 |         functionDeclarations: [{
436 |           name: 'google_search'
437 |         }]
438 |       }],
439 |       safetySettings: []
440 |     });
441 | 
442 |     const response = await result.response;
443 |     let text = response.text();
444 | 
445 |     // Remove any code fencing
446 |     text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
447 | 
448 |     try {
449 |       const verifyData = JSON.parse(text);
450 |       logger.info('Draft verified successfully:', verifyData);
451 |       res.json(verifyData);
452 |     } catch (parseError) {
453 |       logger.error('Failed to parse verification response:', text);
454 |       res.status(500).json({
455 |         error: 'Failed to generate valid verification response',
456 |         details: text
457 |       });
458 |     }
459 |   } catch (error) {
460 |     logger.error('Error verifying article:', error);
461 |     res.status(500).json({ error: 'Failed to verify article' });
462 |   }
463 | });
464 | 
465 | /**
466 |  * Polish content using Anthropic Claude (claude-3-5-sonnet-20241022)
467 |  * @route POST /api/generate/polish
468 |  */
469 | app.post('/api/generate/polish', async (req, res) => {
470 |   try {
471 |     logger.info('Polishing article...');
472 |     const { content, corrections } = req.body; 
473 |     // `content` is the original draft,
474 |     // `corrections` is the JSON from the verify step with any flagged inaccuracies
475 | 
476 |     // Updated prompt that merges content + factual corrections
477 |     const prompt = `You are an expert content editor and writer polishing a blog post written from the company's perspective as an industry authority.
478 | 
479 | ### Important Guidelines
480 | 1. PRESERVE the company's voice and authority - do not tone down or remove company expertise and capabilities
481 | 2. Maintain the company's position as a trusted expert in their field
482 | 3. Keep all company-specific information, experience claims, and solutions intact
483 | 4. Focus on enhancing clarity and readability while preserving the company's authority
484 | 
485 | ### Polishing Steps
486 | EXTREMELY IMPORTANT NOTE: You must write this article in a very human-like tone that is both approachable and engaging while also a confident trusted authority. Your copy should be narrative in nature similar to Donald Miller's writing, you understand that humans enjoy stories and so whenever possible, you use storytelling and narrative direction to get messages and points across, but it's clear what you're discussing, why it should matter to the customer and ultimately what question it is answering for them. You have a bit of the fun edge of "Gary V" and "Alex Hormozi" but it's clear you know your target audience is B2B, mainly enterprise and on linkedin so you write brilliantly and accordingly to these specifications.
487 | 1. Identify and preserve the core message, key facts, and company expertise
488 | 2. Improve clarity, flow, and engagement
489 | 3. Remove any redundant phrases or overused intros
490 | 4. Strengthen transitions between sections
491 | 5. Preserve company perspective and industry authority
492 | 6. Use a professional yet approachable tone
493 | 7. Keep examples that demonstrate company expertise
494 | 8. **Incorporate factual corrections** based on the "corrections" data, BUT:
495 |    - Do not remove or tone down company expertise claims
496 |    - Only modify industry statistics or third-party claims
497 |    - Preserve the company's voice and authority
498 | 
499 | Below is the blog post draft to polish:
500 | <blog_post_draft>
501 | ${content}
502 | </blog_post_draft>
503 | 
504 | Below is the list of flagged inaccuracies and recommended fixes:
505 | <corrections>
506 | ${JSON.stringify(corrections, null, 2)}
507 | </corrections>
508 | 
509 | ### Your Task
510 | - For each flagged inaccuracy in the corrections, carefully evaluate:
511 |   1. If it's about general industry statistics or third-party claims: replace with corrected text
512 |   2. If it's about company expertise or capabilities: preserve the original message while improving clarity
513 | - Maintain the company's authoritative voice throughout
514 | - Keep all company-specific information and expertise claims
515 | - Focus on enhancing readability while preserving the company's position as an industry expert
516 | - Wrap your analysis in <analysis>...</analysis> tags. Summarize major changes or improvements you made.
517 | - Then output the polished blog post in the format:
518 | 
519 | <polished_blog_post>
520 |   <title>[Title here]</title>
521 |   <body>
522 |   [Main content here in paragraphs]
523 |   </body>
524 | </polished_blog_post>
525 | `.trim();
526 | 
527 |     // Log the complete prompt
528 |     logger.info('Complete polishing prompt:', prompt);
529 | 
530 |     const message = await anthropicClient.messages.create({
531 |       model: 'claude-3-5-sonnet-20241022',
532 |       max_tokens: 8192,
533 |       messages: [{ role: 'user', content: prompt }]
534 |     });
535 | 
536 |     logger.info('Article polished successfully');
537 |     res.json({ content: message.content[0].text });
538 |   } catch (error) {
539 |     logger.error('Error polishing article:', error);
540 |     res.status(500).json({ error: 'Failed to polish article' });
541 |   }
542 | });
543 | 
544 | /**
545 |  * Convert Markdown content to SEO-optimized HTML using OpenAI (gpt-4o)
546 |  * @route POST /api/generate/html
547 |  */
548 | app.post('/api/generate/html', async (req, res) => {
549 |   try {
550 |     logger.info('Converting Markdown to HTML...');
551 |     const { content, metadata } = req.body;
552 | 
553 |   const prompt = `
554 | You are an expert at converting Markdown to SEO-optimized HTML.
555 | Use proper semantic tags (h1, h2, etc.), include meta tags, and incorporate relevant keywords.
556 | Ensure the final HTML is clean, valid, and well-structured.
557 | 
558 | ---
559 | Title: ${metadata.title}
560 | Keywords: ${metadata.keywords.join(', ')}
561 | ---
562 | Markdown Content:
563 | ${content}
564 | 
565 | Requirements:
566 | - Use an <h1> tag for the title.
567 | - Use <meta name="keywords" content="..."> for the keywords.
568 | - Provide a <meta name="description" content="A concise, compelling description of the article"> (you may generate one).
569 | - Retain headings as <h2>, <h3> if provided in the Markdown.
570 | - Turn bullet points, lists, images, or links into valid HTML as needed.
571 | - Return only the final HTML (no JSON).
572 | `.trim();
573 | 
574 |     const timestamp = new Date().toISOString();
575 |     const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
576 | 
577 |     const completion = await openAIClient.chat.completions.create({
578 |       model: 'gpt-4o',
579 |       messages: [{ role: 'user', content: promptWithTimestamp }]
580 |     });
581 | 
582 |     const text = completion.choices[0].message.content;
583 |     logger.info('HTML generated successfully');
584 |     res.json({ html: text });
585 |   } catch (error) {
586 |     logger.error('Error generating HTML:', error);
587 |     res.status(500).json({ error: 'Failed to generate HTML' });
588 |   }
589 | });
590 | 
591 | /**
592 |  * Save blog post to database
593 |  * @route POST /api/posts
594 |  */
595 | app.post('/api/posts', async (req, res) => {
596 |   try {
597 |     logger.info('Saving blog post to database...');
598 |     const {
599 |       user_id,
600 |       company_id,
601 |       title_concept,
602 |       structure,
603 |       facts,
604 |       article,
605 |       polished,
606 |       final_html,
607 |     } = req.body;
608 | 
609 |     // Create metadata object from available data
610 |     const metadata = {
611 |       title: structure?.title,
612 |       keywords: structure?.keywords || [],
613 |       sections: structure?.sections || [],
614 |       research_questions: structure?.research_questions || {},
615 |       facts: facts || {}
616 |     };
617 | 
618 |     const { data, error } = await supabase
619 |       .from('blog_posts')
620 |       .insert([
621 |         {
622 |           user_id,
623 |           company_id,
624 |           title_concept,
625 |           structure,
626 |           facts,
627 |           article,
628 |           polished,
629 |           final_html,
630 |           metadata,
631 |           created_at: new Date().toISOString()
632 |         }
633 |       ])
634 |       .select();
635 | 
636 |     if (error) throw error;
637 | 
638 |     logger.info('Blog post saved successfully');
639 |     res.json(data[0]);
640 |   } catch (error) {
641 |     logger.error('Error saving blog post:', error);
642 |     res.status(500).json({ error: 'Failed to save blog post' });
643 |   }
644 | });
645 | 
646 | /**
647 |  * Get all blog posts
648 |  * @route GET /api/posts
649 |  */
650 | app.get('/api/posts', async (req, res) => {
651 |   try {
652 |     logger.info('Fetching all blog posts...');
653 |     
654 |     const { data, error } = await supabase
655 |       .from('blog_posts')
656 |       .select('*')
657 |       .order('created_at', { ascending: false });
658 | 
659 |     if (error) {
660 |       logger.error('Error fetching posts:', error);
661 |       throw error;
662 |     }
663 | 
664 |     logger.info('Blog posts fetched successfully');
665 |     res.json(data);
666 |   } catch (error) {
667 |     logger.error('Error fetching blog posts:', error);
668 |     res.status(500).json({ error: 'Failed to fetch blog posts' });
669 |   }
670 | });
671 | 
672 | /**
673 |  * Get single blog post by ID
674 |  * @route GET /api/posts/:id
675 |  */
676 | app.get('/api/posts/:id', async (req, res) => {
677 |   try {
678 |     const { id } = req.params;
679 |     logger.info(`Fetching blog post with ID: ${id}`);
680 |     
681 |     const { data: existingPost, error: fetchError } = await supabase
682 |       .from('blog_posts')
683 |       .select('*')
684 |       .eq('id', id)
685 |       .maybeSingle();  // Use maybeSingle() instead of single() to avoid errors
686 | 
687 |     if (fetchError) {
688 |       logger.error('Error fetching post:', fetchError);
689 |       throw fetchError;
690 |     }
691 | 
692 |     if (!existingPost) {
693 |       logger.error('Post not found:', id);
694 |       throw new Error(`Post with ID ${id} not found`);
695 |     }
696 | 
697 |     logger.info('Blog post fetched successfully');
698 |     res.json(existingPost);
699 |   } catch (error) {
700 |     logger.error('Error fetching blog post:', error);
701 |     res.status(500).json({ error: 'Failed to fetch blog post' });
702 |   }
703 | });
704 | 
705 | /**
706 |  * Generate social media posts for a blog post
707 |  * @route POST /api/posts/:id/social
708 |  */
709 | app.post('/api/posts/:id/social', async (req, res) => {
710 |   try {
711 |     const { id } = req.params;
712 |     const { content } = req.body;
713 | 
714 |     if (!content) {
715 |       return res.status(400).json({ error: 'Content is required' });
716 |     }
717 | 
718 |     logger.info(`Generating social media posts for blog post ${id}...`);
719 |     logger.info('Content length:', content.length);
720 |     
721 |     // System prompt for GPT-4o
722 |     const systemPrompt = `You are a social media expert. Your task is to create engaging social media posts based on the provided article content.
723 | IMPORTANT: Your response must be a valid JSON object exactly matching this structure, with no additional text or markdown formatting:
724 | {
725 |   "Instagram": {
726 |     "content": "Your Instagram post content here",
727 |     "hashtags": ["hashtag1", "hashtag2"]
728 |   },
729 |   "Facebook": {
730 |     "content": "Your Facebook post content here",
731 |     "link": "https://example.com"
732 |   },
733 |   "X": {
734 |     "content": "Your X post content here",
735 |     "hashtags": ["hashtag1", "hashtag2"]
736 |   },
737 |   "LinkedIn": {
738 |     "content": "Your LinkedIn post content here",
739 |     "link": "https://example.com"
740 |   }
741 | }
742 | 
743 | Guidelines:
744 | 1. Response MUST be valid JSON
745 | 2. Keep Instagram and X posts concise
746 | 3. Include relevant hashtags
747 | 4. Maintain the article's tone
748 | 5. Include emojis where appropriate
749 | 6. DO NOT include any text outside the JSON structure`;
750 | 
751 |     try {
752 |       // Call GPT-4o
753 |       const completion = await openAIClient.chat.completions.create({
754 |         model: 'gpt-4o',
755 |         messages: [
756 |           { role: 'system', content: systemPrompt },
757 |           { role: 'user', content }
758 |         ],
759 |         temperature: 0.7,
760 |       });
761 | 
762 |       logger.info('GPT response received');
763 |       
764 |       const rawContent = completion.choices[0].message.content;
765 |       logger.info('Raw GPT response:', rawContent);
766 | 
767 |       let socialPosts;
768 |       try {
769 |         logger.info('Attempting to parse GPT response...');
770 |         // Try to parse the JSON response
771 |         socialPosts = JSON.parse(rawContent.trim());
772 |         logger.info('Successfully parsed social posts:', JSON.stringify(socialPosts, null, 2));
773 |       } catch (parseError) {
774 |         logger.error('Error parsing GPT response:', parseError);
775 |         logger.error('Raw content that failed to parse:', rawContent);
776 |         throw new Error(`Failed to parse GPT response: ${parseError.message}`);
777 |       }
778 | 
779 |       // First, fetch the existing post
780 |       logger.info('Searching for post with ID:', id);
781 |       const query = supabase
782 |         .from('blog_posts')
783 |         .select('*')
784 |         .eq('id', id)
785 |         .maybeSingle();  // Use maybeSingle() instead of single() to avoid errors
786 | 
787 |       // Log the query details
788 |       logger.info('Query details:', {
789 |         table: 'blog_posts',
790 |         id: id,
791 |         supabaseUrl: supabaseUrl,
792 |       });
793 | 
794 |       const { data: existingPost, error: fetchError } = await query;
795 | 
796 |       logger.info('Database query result:', { 
797 |         data: existingPost, 
798 |         error: fetchError,
799 |         found: existingPost !== null
800 |       });
801 | 
802 |       if (fetchError) {
803 |         logger.error('Error fetching post:', fetchError);
804 |         throw fetchError;
805 |       }
806 | 
807 |       if (!existingPost) {
808 |         logger.error('Post not found in database. ID:', id);
809 |         // Let's also check what posts do exist
810 |         const { data: allPosts, error: listError } = await supabase
811 |           .from('blog_posts')
812 |           .select('id')
813 |           .limit(5);
814 |         
815 |         if (!listError) {
816 |           logger.info('First 5 posts in database:', allPosts);
817 |         }
818 |         throw new Error(`Post with ID ${id} not found`);
819 |       }
820 | 
821 |       logger.info('Found existing post:', existingPost.id);
822 | 
823 |       // Now update just the social media fields
824 |       const { error: updateError } = await supabase
825 |         .from('blog_posts')
826 |         .update({
827 |           instagram_post_content: socialPosts.Instagram.content,
828 |           instagram_hashtags: socialPosts.Instagram.hashtags,
829 |           facebook_post_content: socialPosts.Facebook.content,
830 |           facebook_post_link: socialPosts.Facebook.link,
831 |           x_post_content: socialPosts.X.content,
832 |           x_hashtags: socialPosts.X.hashtags,
833 |           linkedin_post_content: socialPosts.LinkedIn.content,
834 |           linkedin_post_link: socialPosts.LinkedIn.link,
835 |           social_posts_generated_at: new Date().toISOString()
836 |         })
837 |         .eq('id', id);
838 | 
839 |       if (updateError) throw updateError;
840 | 
841 |       logger.info('Successfully updated blog post with social content');
842 |       res.json(socialPosts);
843 |     } catch (error) {
844 |       logger.error('Error generating social media posts:', error);
845 |       res.status(500).json({ error: 'Failed to generate social media posts' });
846 |     }
847 |   } catch (error) {
848 |     logger.error('Error in social media generation:', error);
849 |     res.status(500).json({ error: 'Failed to generate social media posts' });
850 |   }
851 | });
852 | 
853 | /**
854 |  * Generate email drip campaign for a blog post
855 |  * @route POST /api/posts/:id/email-campaign
856 |  */
857 | app.post('/api/posts/:id/email-campaign', async (req, res) => {
858 |   try {
859 |     const { id } = req.params;
860 |     const { content } = req.body;
861 | 
862 |     if (!content) {
863 |       return res.status(400).json({ error: 'Content is required' });
864 |     }
865 | 
866 |     logger.info(`Generating email campaign for blog post ${id}...`);
867 |     logger.info('Content length:', content.length);
868 | 
869 |     // Generate email campaign using Gemini
870 |     const prompt = `You are an expert B2B email marketing campaign writer with 15 years of experience. You always write 4 drips, each drip is engaging, informing, and opens up with a question that addresses the main content's painpoint(s). You'll return the email campaign in JSON format including a subject line and email content for each of the 4 drips. The email campaigns focus should be based entirely on the content below. Each email should continue from the next, for example - email 2 should include a reference to the first ie. "I wanted to follow up on the last email I sent you." The emails should be empathetic with a tone that the writer cares about the reader and doesn't want them to miss out on the content. The last email should be "This will be my final email regarding...." but always include something like "I'd still love to connect with you, how is your calendar looking next week?"
871 | 
872 | Here's the blog article to base the campaign on:
873 | ${content}
874 | 
875 | Return ONLY the JSON in this exact format, with no other text:
876 | {
877 |   "drips": [
878 |     {
879 |       "subject": "Email 1 Subject",
880 |       "content": "Email 1 Content"
881 |     },
882 |     {
883 |       "subject": "Email 2 Subject",
884 |       "content": "Email 2 Content"
885 |     },
886 |     {
887 |       "subject": "Email 3 Subject",
888 |       "content": "Email 3 Content"
889 |     },
890 |     {
891 |       "subject": "Email 4 Subject",
892 |       "content": "Email 4 Content"
893 |     }
894 |   ]
895 | }`;
896 | 
897 |     // Log full content and prompt separately for clarity
898 |     logger.info('BLOG CONTENT BEING USED:');
899 |     logger.info('----------------------------------------');
900 |     logger.info(content);
901 |     logger.info('----------------------------------------');
902 |     
903 |     logger.info('FULL PROMPT TO GEMINI:');
904 |     logger.info('----------------------------------------');
905 |     logger.info(prompt);
906 |     logger.info('----------------------------------------');
907 | 
908 |     const model = googleClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
909 |     logger.info('Created Gemini model for email campaign');
910 | 
911 |     const timestamp = new Date().toISOString();
912 |     const promptWithTimestamp = `${prompt}\n\nTimestamp: ${timestamp}`;
913 | 
914 |     logger.info('Sending request to Gemini with config:', {
915 |       model: 'gemini-2.0-flash-exp',
916 |       temperature: 0.9,
917 |       maxOutputTokens: 8192,
918 |       timestamp
919 |     });
920 | 
921 |     const result = await model.generateContent({
922 |       contents: [{ role: 'user', parts: [{ text: promptWithTimestamp }] }],
923 |       generationConfig: {
924 |         temperature: 0.9,
925 |         maxOutputTokens: 8192,
926 |         candidateCount: 1,
927 |         stopSequences: []
928 |       },
929 |       tools: [{
930 |         functionDeclarations: [{
931 |           name: 'google_search'
932 |         }]
933 |       }],
934 |       safetySettings: []
935 |     });
936 |     logger.info('Generated content from Gemini');
937 | 
938 |     const response = await result.response;
939 |     let text = response.text();
940 |     logger.info('Raw response from Gemini:', {
941 |       responseLength: text.length,
942 |       responsePreview: text.substring(0, 500) + '...'
943 |     });
944 | 
945 |     // Remove markdown code blocks if present
946 |     text = text.replace(/```json\n/, '').replace(/```/g, '').trim();
947 |     logger.info('Cleaned response text:', {
948 |       cleanedLength: text.length,
949 |       cleanedPreview: text.substring(0, 500) + '...'
950 |     });
951 | 
952 |     // Parse the response
953 |     let emailCampaign;
954 |     try {
955 |       emailCampaign = JSON.parse(text);
956 |       logger.info('Successfully parsed JSON response:', {
957 |         numberOfDrips: emailCampaign.drips?.length,
958 |         firstDripSubject: emailCampaign.drips?.[0]?.subject,
959 |         structure: JSON.stringify(emailCampaign, null, 2)
960 |       });
961 |     } catch (parseError) {
962 |       logger.error('Failed to parse AI response as JSON:', {
963 |         text,
964 |         error: parseError.message
965 |       });
966 |       throw new Error(`Failed to parse Gemini response: ${parseError.message}`);
967 |     }
968 | 
969 |     // Add generated timestamp
970 |     emailCampaign.generated_at = new Date().toISOString();
971 | 
972 |     // Update the post with the email campaign
973 |     logger.info('Updating blog post with generated email campaign...');
974 |     const { error: updateError } = await supabase
975 |       .from('blog_posts')
976 |       .update({
977 |         email_drip_campaigns: emailCampaign
978 |       })
979 |       .eq('id', id);
980 | 
981 |     if (updateError) {
982 |       logger.error('Error updating post with email campaign:', updateError);
983 |       throw updateError;
984 |     }
985 | 
986 |     logger.info('Successfully generated and saved email campaign');
987 |     res.json(emailCampaign);
988 |   } catch (error) {
989 |     logger.error('Error in email campaign generation:', {
990 |       error: error.message,
991 |       stack: error.stack
992 |     });
993 |     res.status(500).json({ 
994 |       error: 'Failed to generate email campaign', 
995 |       details: error.message 
996 |     });
997 |   }
998 | });
999 | 
1000 | /**
1001 |  * Debug route to check database contents
1002 |  * @route GET /debug/posts
1003 |  */
1004 | app.get('/debug/posts', async (req, res) => {
1005 |   try {
1006 |     logger.info('Debug: Fetching all blog posts...');
1007 |     
1008 |     const { data, error } = await supabase
1009 |       .from('blog_posts')
1010 |       .select('id, created_at')
1011 |       .order('created_at', { ascending: false });
1012 | 
1013 |     if (error) {
1014 |       logger.error('Debug: Error fetching posts:', error);
1015 |       throw error;
1016 |     }
1017 | 
1018 |     logger.info('Debug: Found posts:', JSON.stringify(data, null, 2));
1019 |     res.json({
1020 |       count: data.length,
1021 |       posts: data,
1022 |       supabaseUrl: supabaseUrl // Log the URL we're connected to
1023 |     });
1024 |   } catch (error) {
1025 |     logger.error('Debug: Error in debug route:', error);
1026 |     res.status(500).json({ error: error.message });
1027 |   }
1028 | });
1029 | 
1030 | /**
1031 |  * Fallback error handling
1032 |  */
1033 | app.use((err, req, res, next) => {
1034 |   logger.error('Unhandled error:', err);
1035 |   res.status(500).json({ error: 'Internal server error' });
1036 | });
1037 | 
1038 | /**
1039 |  * Start the server
1040 |  */
1041 | const PORT = process.env.PORT || 3001;
1042 | app.listen(PORT, () => {
1043 |   logger.info(`Server is running on port ${PORT}`);
1044 | });
```

server.ts
```
1 | import express from 'express';
2 | import cors from 'cors';
3 | import { fileURLToPath } from 'url';
4 | import { dirname, join } from 'path';
5 | 
6 | const __filename = fileURLToPath(import.meta.url);
7 | const __dirname = dirname(__filename);
8 | 
9 | const app = express();
10 | app.use(cors());
11 | app.use(express.json());
12 | 
13 | // Import route handlers
14 | const generateRoutes = join(__dirname, 'generate');
15 | app.use('/api/generate', express.static(generateRoutes));
16 | 
17 | const port = process.env.PORT || 3001;
18 | app.listen(port, () => {
19 |   console.log(`API server running on port ${port}`);
20 | });
```

start.sh
```
1 | #!/bin/bash
2 | npm install
3 | npm start
```

stripe.js
```
1 | import Stripe from 'stripe';
2 | import { createClient } from '@supabase/supabase-js';
3 | import { logger } from './logger.js';
4 | 
5 | const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
6 | const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
7 | 
8 | export async function createCheckoutSession(req, res) {
9 |   try {
10 |     const { priceId, userId, returnUrl } = req.body;
11 |     
12 |     if (!priceId || !userId) {
13 |       logger.error('Missing required fields:', { priceId, userId });
14 |       return res.status(400).json({ error: 'Missing required fields' });
15 |     }
16 | 
17 |     logger.info('Creating checkout session for user:', { userId, priceId });
18 |     logger.info('Supabase config:', { 
19 |       url: process.env.VITE_SUPABASE_URL,
20 |       hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY
21 |     });
22 | 
23 |     // Get user details using RPC
24 |     logger.info('Fetching user details for:', userId);
25 |     const { data: user, error: userError } = await supabase
26 |       .rpc('get_user_details', { user_id: userId });
27 | 
28 |     if (userError) {
29 |       logger.error('Error fetching user:', userError);
30 |       return res.status(400).json({ error: 'Error fetching user: ' + userError.message });
31 |     }
32 | 
33 |     if (!user || !user.email) {
34 |       logger.error('User not found or missing email:', userId);
35 |       return res.status(404).json({ error: 'User not found or missing email' });
36 |     }
37 | 
38 |     logger.info('User details retrieved:', { 
39 |       hasEmail: !!user.email,
40 |       hasStripeId: !!user.stripe_customer_id,
41 |       subscriptionStatus: user.subscription_status
42 |     });
43 | 
44 |     let customerId = user.stripe_customer_id;
45 | 
46 |     if (!customerId) {
47 |       logger.info('Creating new Stripe customer for user:', userId);
48 |       const customer = await stripe.customers.create({
49 |         email: user.email,
50 |         metadata: {
51 |           userId: userId
52 |         }
53 |       });
54 |       customerId = customer.id;
55 |       logger.info('Created Stripe customer:', customerId);
56 | 
57 |       // Update user with Stripe customer ID
58 |       logger.info('Updating user with Stripe customer ID');
59 |       const { error: updateError } = await supabase
60 |         .rpc('update_user_stripe_customer', {
61 |           user_id: userId,
62 |           customer_id: customerId
63 |         });
64 | 
65 |       if (updateError) {
66 |         logger.error('Error updating user with Stripe customer ID:', updateError);
67 |         return res.status(500).json({ error: 'Error updating user' });
68 |       }
69 |       logger.info('Successfully updated user with Stripe customer ID');
70 |     }
71 | 
72 |     // Create checkout session
73 |     logger.info('Creating Stripe checkout session');
74 |     const session = await stripe.checkout.sessions.create({
75 |       customer: customerId,
76 |       payment_method_types: ['card'],
77 |       line_items: [
78 |         {
79 |           price: priceId,
80 |           quantity: 1,
81 |         },
82 |       ],
83 |       mode: 'subscription',
84 |       success_url: returnUrl || `${process.env.VITE_APP_URL}/company-setup?session_id={CHECKOUT_SESSION_ID}`,
85 |       cancel_url: `${process.env.VITE_APP_URL}/billing-setup`,
86 |     });
87 | 
88 |     logger.info('Checkout session created:', session.id);
89 |     return res.json({ url: session.url });
90 |   } catch (error) {
91 |     logger.error('Error in createCheckoutSession:', error);
92 |     return res.status(500).json({ error: 'Internal server error: ' + error.message });
93 |   }
94 | }
95 | 
96 | export async function handleStripeWebhook(req, res) {
97 |   const sig = req.headers['stripe-signature'];
98 |   let event;
99 | 
100 |   try {
101 |     event = stripe.webhooks.constructEvent(
102 |       req.body,
103 |       sig,
104 |       process.env.STRIPE_WEBHOOK_SECRET
105 |     );
106 |   } catch (err) {
107 |     logger.error('Webhook signature verification failed:', err);
108 |     return res.status(400).send(`Webhook Error: ${err.message}`);
109 |   }
110 | 
111 |   try {
112 |     switch (event.type) {
113 |       case 'customer.subscription.created':
114 |       case 'customer.subscription.updated':
115 |         const subscription = event.data.object;
116 |         const customerId = subscription.customer;
117 |         
118 |         // Get user ID from customer metadata
119 |         const customer = await stripe.customers.retrieve(customerId);
120 |         const userId = customer.metadata.userId;
121 | 
122 |         if (!userId) {
123 |           logger.error('No userId found in customer metadata:', customerId);
124 |           return res.status(400).json({ error: 'No userId found' });
125 |         }
126 | 
127 |         // Update subscription status
128 |         const { error: updateError } = await supabase
129 |           .rpc('update_user_subscription', {
130 |             user_id: userId,
131 |             subscription_id: subscription.id,
132 |             status: subscription.status,
133 |             period_end: new Date(subscription.current_period_end * 1000).toISOString()
134 |           });
135 | 
136 |         if (updateError) {
137 |           logger.error('Error updating subscription status:', updateError);
138 |           return res.status(500).json({ error: 'Error updating subscription status' });
139 |         }
140 |         break;
141 | 
142 |       case 'customer.subscription.deleted':
143 |         const deletedSubscription = event.data.object;
144 |         const deletedCustomerId = deletedSubscription.customer;
145 |         
146 |         // Get user ID from customer metadata
147 |         const deletedCustomer = await stripe.customers.retrieve(deletedCustomerId);
148 |         const deletedUserId = deletedCustomer.metadata.userId;
149 | 
150 |         if (!deletedUserId) {
151 |           logger.error('No userId found in customer metadata:', deletedCustomerId);
152 |           return res.status(400).json({ error: 'No userId found' });
153 |         }
154 | 
155 |         // Update subscription status to inactive
156 |         const { error: deleteError } = await supabase
157 |           .rpc('update_user_subscription', {
158 |             user_id: deletedUserId,
159 |             subscription_id: null,
160 |             status: 'inactive',
161 |             period_end: null
162 |           });
163 | 
164 |         if (deleteError) {
165 |           logger.error('Error updating subscription status:', deleteError);
166 |           return res.status(500).json({ error: 'Error updating subscription status' });
167 |         }
168 |         break;
169 |     }
170 | 
171 |     return res.json({ received: true });
172 |   } catch (error) {
173 |     logger.error('Error processing webhook:', error);
174 |     return res.status(500).json({ error: 'Webhook processing failed' });
175 |   }
176 | }
```

