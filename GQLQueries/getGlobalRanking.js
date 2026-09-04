import cache, { TTL } from '../utils/cache.js';

const getGlobalRanking = async (username) => {
  const cacheKey = `problem_ranking_${username}`;
  const cachedData = await cache.get(cacheKey);

  if (cachedData !== null) {
    console.log(`Cache hit for problem ranking: ${username}`);
    return cachedData;
  }

  console.log(`Cache miss for problem ranking: ${username}, fetching from API`);

  const query = `
    query getUserProblemRanking($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          ranking
        }
      }
    }`;

  const variables = { username };

  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();
  const profile = data.data?.matchedUser?.profile ?? null;

  const result = {
    username,
    problemRank: profile?.ranking ?? null,
  };

  await cache.set(cacheKey, result, TTL.GLOBAL_RANKING);

  return result;
};

export default getGlobalRanking;
