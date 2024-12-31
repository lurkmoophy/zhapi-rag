import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
// Access environment variables (set these in Netlify dashboard)
const PINECONE_API_KEY = process.env.VITE_PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.VITE_PINECONE_INDEX_NAME;
const PINECONE_QUERY_URL = `${process.env.VITE_PINECONE_URL}/query`;
const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY;

// Netlify Function Handler
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const { query } = JSON.parse(event.body);

  if (!query) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query is required' }),
    };
  }

  try {
    // Step 1: Use OpenAI to generate a query embedding
    const embeddingResponse = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: 'text-embedding-ada-002',
        input: query,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const embedding = embeddingResponse.data.data[0].embedding;

    // Step 2: Query Pinecone with the embedding
    const pineconeResponse = await axios.post(
      PINECONE_QUERY_URL,
      {
        vector: embedding,
        topK: 5,
        includeMetadata: true,
      },
      {
        headers: {
          'Api-Key': PINECONE_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const matches = pineconeResponse.data.matches;

    if (!matches || matches.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ response: "I couldn't find any relevant information." }),
      };
    }

    // Step 3: Filter matches and deduplicate content
    const SIMILARITY_THRESHOLD = 0.7;
    const filteredMatches = matches.filter((match) => match.score >= SIMILARITY_THRESHOLD);

    if (filteredMatches.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ response: "No highly relevant content was found for your query." }),
      };
    }

    const uniqueContent = new Map();
    filteredMatches.forEach((match) => {
      if (!uniqueContent.has(match.metadata.content)) {
        uniqueContent.set(match.metadata.content, {
          name: match.metadata.name,
          url: match.metadata.url,
        });
      }
    });

    const combinedContent = Array.from(uniqueContent.keys()).join('\n\n');
    const sourcesHtml = Array.from(uniqueContent.values())
      .map(
        (source) =>
          `<li><a href="${source.url}" target="_blank">${source.name}</a></li>`
      )
      .join('');

    // Step 4: Generate a summary using OpenAI
    const finalResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant summarizing content for a design system.' },
          { role: 'user', content: `Summarize the following content based on the query: "${query}".\n\n${combinedContent}` },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const summary = formatSummary(finalResponse.data.choices[0].message.content);

    // Step 5: Return the formatted response
    return {
      statusCode: 200,
      body: JSON.stringify({
        response: `${summary}<h4>Sources:</h4><ul>${sourcesHtml}</ul>`,
      }),
    };
  } catch (error) {
    console.error('Error querying Pinecone or OpenAI:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred while processing the request.' }),
    };
  }
}

// Helper function to format summary
function formatSummary(summary) {
  return summary
    .replace(/\*\*(.*?)\*\*/g, '<h3>$1</h3>') // Bold to <h3>
    .replace(/^- (.*)/gm, '<li>$1</li>') // List items
    .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>') // Wrap lists
    .replace(/<\/ul>\s*<ul>/g, ''); // Remove duplicate lists
}
