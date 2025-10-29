# Update Timer Feature

## Overview
A real-time countdown timer that displays when each page's cached data will expire and be refreshed.

## Display Format

The timer shows in a small, unobtrusive text below each page heading:

- **"Updates in 9m 45s"** - Shows minutes and seconds when under 1 hour
- **"Updates in 1h 30m"** - Shows hours and minutes when under 24 hours
- **"Updates in 2d 5h"** - Shows days and hours when over 24 hours
- **"Updates on next open"** - When no cache exists yet
- **"Updating..."** - When cache has expired and will refresh

## Page-Specific Timers

### Activity Page
- **Monitors**: Recent submission cache (5 submissions per user)
- **Cache TTL**: 10 minutes
- **Updates**: Shows the shortest time until any user's submissions expire

### Leaderboard Page
- **Monitors**:
  - User problem stats cache (2 hour TTL)
  - Daily submissions cache (20 submissions per user, 10 minute TTL)
- **Cache TTL**: Varies (2 hours for stats, 10 minutes for submissions)
- **Updates**: Shows the shortest time among all monitored caches

### Strikes Page
- **Monitors**: Recent submission cache (30 submissions per user)
- **Cache TTL**: 10 minutes
- **Updates**: Shows the shortest time until any user's submissions expire

## Technical Implementation

### Files Modified
1. **utils/cache.js** - Added `getMetadata()` method to retrieve cache expiration info
2. **utils/updateTimer.js** - New module for timer logic and display
3. **popup/popup.js** - Integrated timers for each page
4. **popup/popup.html** - Added `page-header` containers
5. **popup/popup.css** - Styled the timer display

### How It Works

1. **Timer Creation**: When a page loads, `createUpdateTimer()` is called with:
   - Container ID (e.g., 'activity', 'leaderboard', 'strikes')
   - Array of cache keys to monitor

2. **Cache Monitoring**: Timer checks all relevant cache keys and finds the shortest time until expiry

3. **Live Updates**: Timer updates every second to show countdown in real-time

4. **Automatic Cleanup**: When timers are destroyed (page switch, popup close), intervals are cleared

### Key Functions

#### `createUpdateTimer(containerId, cacheKeys)`
Creates and manages a timer for a specific page.

```javascript
// Example: Activity page timer
const allUsers = ['user1', 'user2'];
activityTimer = createUpdateTimer('activity', getSubmissionsCacheKeys(allUsers, 5));
```

#### `getSubmissionsCacheKeys(usernames, limit)`
Generates cache keys for submission data.

#### `getUserStatsCacheKeys(usernames)`
Generates cache keys for user statistics data.

#### `formatTime(ms)`
Converts milliseconds to human-readable format (e.g., "9m 45s").

## User Benefits

1. **Transparency**: Users know exactly when data will refresh
2. **Patience**: Clear expectations prevent excessive popup reopening
3. **Trust**: Shows the caching system is working correctly
4. **Control**: Users can wait for auto-refresh or manually reopen to force update

## Design Choices

### Why Shortest Time?
Each page may monitor multiple cache keys with different TTLs. We show the shortest time because that's when the page will start showing partial fresh data.

### Why Update Every Second?
Provides smooth, real-time countdown experience. The overhead is minimal (just timestamp comparisons).

### Why Per-Page Timers?
Different pages cache different data with different TTLs. Page-specific timers give accurate, relevant information.

## Testing

To verify timers work:

1. Open extension and observe timer on Activity page
2. Wait and watch the countdown decrease
3. Switch to Leaderboard tab - timer should show different time
4. Switch to Strikes tab - timer should show another time
5. After countdown reaches 0, reopen popup to see fresh data

## Future Enhancements

- Add refresh button next to timer for manual refresh
- Show "Loading..." state when fetching fresh data
- Add visual indicator when cache is about to expire (< 1 minute)
- Allow users to configure cache TTLs in settings
