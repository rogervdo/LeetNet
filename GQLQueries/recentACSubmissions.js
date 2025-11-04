import cache, { TTL } from '../utils/cache.js';

const getACSubmissions = async (username, limit) => {
  // Check cache first
  const cacheKey = `submissions_${username}_${limit}`;
  const cachedData = await cache.get(cacheKey);

  if (cachedData !== null) {
    console.log(`Cache hit for submissions: ${username} (limit: ${limit})`);
    return cachedData;
  }

  console.log(`Cache miss for submissions: ${username} (limit: ${limit}), fetching from API`);

  const query = `query getACSubmissions ($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
            title
            titleSlug
            timestamp
            statusDisplay
            lang
        }
    }`;

  const variables = {
    username,
    limit,
  };

  try {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': 'Bearer YOUR_API_TOKEN' // Add your authentication token if required
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(result.errors.map((error) => error.message).join(', '));
    }

    const submissions = result.data.recentAcSubmissionList.map((submission) => ({
      ...submission,
      username,
    }));

    // Cache the result with 10-minute TTL
    await cache.set(cacheKey, submissions, TTL.SUBMISSIONS);

    return submissions;
  } catch (error) {
    console.error('Error fetching data:', error);
    return [];
  }
};

export default getACSubmissions;

