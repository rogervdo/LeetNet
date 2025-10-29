import cache, { TTL } from '../utils/cache.js';

const getUserProfilePic = async (username) => {
    // Check cache first
    const cacheKey = `profile_pic_${username}`;
    const cachedData = await cache.get(cacheKey);

    if (cachedData !== null) {
        console.log(`Cache hit for profile pic: ${username}`);
        return cachedData;
    }

    console.log(`Cache miss for profile pic: ${username}, fetching from API`);

    const query = `
    query userPublicProfile($username: String!) {
        matchedUser(username: $username) {
            profile {
                userAvatar
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

    if (data.data.matchedUser === null) {
        return null;
    }

    const profileData = data.data.matchedUser.profile;

    // Cache the result with 24-hour TTL
    await cache.set(cacheKey, profileData, TTL.PROFILE_PIC);

    return profileData;
};

export default getUserProfilePic;