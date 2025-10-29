import cache, { TTL } from '../utils/cache.js';

const getUserProblemStats = async (username) => {
    // Check cache first
    const cacheKey = `user_stats_${username}`;
    const cachedData = await cache.get(cacheKey);

    if (cachedData !== null) {
        console.log(`Cache hit for user stats: ${username}`);
        return cachedData;
    }

    console.log(`Cache miss for user stats: ${username}, fetching from API`);

    const query = `
    query getUserProfile($username: String!) {
        matchedUser(username: $username) {
            submitStats {
                acSubmissionNum {
                    difficulty
                    count
                    submissions
                }
            }
        }
    }`;

    const variables = {
        username
    };

    const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        //   'Authorization': 'Bearer YOUR_API_TOKEN' // Add your authentication token if required
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();

    data.data.matchedUser.submitStats.username = username;
    // add profile pic here?

    const statsData = data.data.matchedUser.submitStats;

    // Cache the result with 2-hour TTL
    await cache.set(cacheKey, statsData, TTL.USER_STATS);

    return statsData;
};

export default getUserProblemStats;
