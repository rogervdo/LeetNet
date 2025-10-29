# Code or Die

Extension to view the activity of your friends on LeetCode.

Code or Die is an extension that allows you to view your friends LeetCode activity and have friendly competitions through leaderboards that track your problems solved.

Just search up your friends' usernames, add them, and follow your feed for new updates on problems your friends have been solving. Get ideas for new problems to solve, compete on the leaderboard, or keep your friends accountable.

See how many strikes (days in a row) your friends have without doing leetcodes

## Features

- **Activity Feed**: View recent submissions from you and your friends
- **Leaderboard**: Track problem counts across different difficulty levels
- **Daily Leaderboard**: See who's solved the most problems today
- **Strikes System**: Track consecutive days without solving problems
- **Smart Caching**: Fast loading with intelligent caching system

## Performance

This extension now includes a comprehensive caching system that:
- Reduces API calls to LeetCode's servers by up to 90%
- Provides instant loading for cached data
- Automatically expires stale data based on update frequency
- Cleans up expired cache entries automatically

See [CACHING.md](CACHING.md) for detailed information about the caching implementation.

## How it was built

Code or Die was built and improved upon DakshinD's LeetNet extension. Original repo: https://github.com/DakshinD/LeetNet

