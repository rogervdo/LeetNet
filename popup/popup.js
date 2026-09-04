import getUserProblemStats from '../GQLQueries/getUserProblemStats.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import getGlobalRanking from '../GQLQueries/getGlobalRanking.js';
import questionDifficulty from '../GQLQueries/questionDifficulty.js';
import getACSubmissions from '../GQLQueries/recentACSubmissions.js';
import cache, { TTL, getTTLUntilMidnight } from '../utils/cache.js';
import { getLocalDateString, getTodayInTimezone, getUserTimezone } from '../utils/timezoneHelper.js';
import { createUpdateTimer, getSubmissionsCacheKeys, getUserStatsCacheKeys, getGlobalRankingCacheKeys } from '../utils/updateTimer.js';
import {
  displayACSubmissions,
  displayContestLeaderboard,
  displayFriendsList,
  displayGlobalRankings,
  displayLeaderboard,
  displayStrikesUsers,
} from './display.js';

// Global timer references
let activityTimer = null;
let leaderboardTimer = null;
let strikesTimer = null;
let globalRankingsTimer = null;

const TAB_CONFIG = [
  { pageId: 'activity', key: 'activity', tabId: 'activity-tab' },
  { pageId: 'leaderboard', key: 'leaderboard', tabId: 'leaderboard-tab' },
  { pageId: 'contest', key: 'contest', tabId: 'contest-tab' },
  { pageId: 'global-rankings', key: 'globalRankings', tabId: 'global-rankings-tab' },
  { pageId: 'strikes', key: 'strikes', tabId: 'strikes-tab' },
];

const DEFAULT_ENABLED_TABS = {
  activity: true,
  leaderboard: true,
  contest: true,
  globalRankings: true,
  strikes: true,
};

let cachedEnabledTabs = { ...DEFAULT_ENABLED_TABS };

function mergeEnabledTabs(stored) {
  return { ...DEFAULT_ENABLED_TABS, ...stored };
}

function getEnabledTabs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['enabledTabs'], (result) => {
      cachedEnabledTabs = mergeEnabledTabs(result.enabledTabs);
      resolve(cachedEnabledTabs);
    });
  });
}

function saveEnabledTabs(enabledTabs) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ enabledTabs }, () => {
      cachedEnabledTabs = enabledTabs;
      resolve();
    });
  });
}

function getFirstEnabledPageId(enabledTabs = cachedEnabledTabs) {
  const firstEnabled = TAB_CONFIG.find((tab) => enabledTabs[tab.key]);
  return firstEnabled ? firstEnabled.pageId : 'activity';
}

function isPageEnabled(pageId, enabledTabs = cachedEnabledTabs) {
  const tab = TAB_CONFIG.find((t) => t.pageId === pageId);
  return tab ? enabledTabs[tab.key] : true;
}

function updateTabToggleDisabledState(enabledTabs) {
  const enabledCount = Object.values(enabledTabs).filter(Boolean).length;
  document.querySelectorAll('[data-tab-key]').forEach((checkbox) => {
    const key = checkbox.dataset.tabKey;
    checkbox.disabled = enabledTabs[key] && enabledCount <= 1;
  });
}

function applyTabVisibility(enabledTabs) {
  TAB_CONFIG.forEach(({ key, tabId }) => {
    const tabEl = document.getElementById(tabId);
    if (tabEl) {
      tabEl.style.display = enabledTabs[key] ? '' : 'none';
    }
  });

  updateTabToggleDisabledState(enabledTabs);

  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id;
    if (pageId !== 'settings' && pageId !== 'username-input' && !isPageEnabled(pageId, enabledTabs)) {
      showPage(getFirstEnabledPageId(enabledTabs));
    }
  }
}

async function initTabVisibilitySettings() {
  const enabledTabs = await getEnabledTabs();

  document.querySelectorAll('[data-tab-key]').forEach((checkbox) => {
    checkbox.checked = enabledTabs[checkbox.dataset.tabKey];
  });

  applyTabVisibility(enabledTabs);
}

// Legacy streak corrections for users affected before the fix was implemented
// Format: 'username': { streak: number, asOfDate: 'YYYY-MM-DD' }
// The streak will be recalculated from asOfDate to today when applied
const LEGACY_STREAK_CORRECTIONS = {
  Pablo_Z: { streak: 12, asOfDate: '2025-11-15' },
  Jordx: { streak: 11, asOfDate: '2025-11-15' },
};

/**
 * Initialize previousStreaks with legacy corrections if needed
 * This runs once when the extension loads after the update
 * Calculates forward from the reference date to account for late updates
 */
async function initializeLegacyStreaks() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['previousStreaks', 'legacyStreaksApplied', 'timezone'], async (result) => {
      // Only apply legacy corrections if they haven't been applied yet
      if (result.legacyStreaksApplied) {
        console.log('[Legacy Streaks] Already applied, skipping');
        resolve();
        return;
      }

      const currentStreaks = result.previousStreaks || {};
      const dailyActivityLog = result.dailyActivityLog || {};
      const timezone = result.timezone || 'America/Chicago';
      let updated = false;
      let activityLogUpdated = false;

      // Apply legacy corrections with date calculation
      for (const [username, correction] of Object.entries(LEGACY_STREAK_CORRECTIONS)) {
        try {
          const { streak: baseStreak, asOfDate } = correction;

          // Calculate how many days have passed since the reference date
          const referenceDate = new Date(asOfDate + 'T00:00:00');
          const today = new Date();
          const daysPassed = Math.floor((today - referenceDate) / (1000 * 60 * 60 * 24));

          console.log(
            `[Legacy Streaks] ${username}: Base streak ${baseStreak} as of ${asOfDate}, ${daysPassed} days ago`
          );

          // Backfill activity log for the streak days
          // This creates the immutable record needed for strike detection
          if (!dailyActivityLog[username]) {
            dailyActivityLog[username] = {};
          }

          if (daysPassed === 0) {
            // Same day as reference, use base streak
            currentStreaks[username] = baseStreak;
            console.log(`[Legacy Streaks] ${username}: Set to ${baseStreak} (reference day)`);

            // Backfill activity log for reference date
            dailyActivityLog[username][asOfDate] = true;
            activityLogUpdated = true;
            updated = true;
          } else if (daysPassed > 0) {
            // Days have passed, need to check if they solved problems in between
            // Fetch their submissions to see activity since reference date
            const submissions = await getACSubmissions(username, 30);

            // Count consecutive days WITH submissions from reference date forward
            let additionalDays = 0;
            const activeDates = [asOfDate]; // Start with reference date

            for (let daysAgo = daysPassed - 1; daysAgo >= 0; daysAgo--) {
              const targetDate = new Date(today);
              targetDate.setDate(targetDate.getDate() - daysAgo);
              const targetDateStr = targetDate.toLocaleDateString('en-CA', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              });

              const daySubmissions = submissions.filter((submission) => {
                const submissionDate = new Date(submission.timestamp * 1000);
                return submissionDate.toDateString() === targetDate.toDateString();
              });

              if (daySubmissions.length > 0) {
                additionalDays++;
                activeDates.push(targetDateStr);
              } else {
                // Gap found, streak broken
                console.log(`[Legacy Streaks] ${username}: Streak broken ${daysAgo} days ago`);
                break;
              }
            }

            const finalStreak = baseStreak + additionalDays;
            currentStreaks[username] = finalStreak;
            console.log(
              `[Legacy Streaks] ${username}: Calculated ${finalStreak} (base ${baseStreak} + ${additionalDays} additional days)`
            );

            // Backfill activity log for all active dates
            activeDates.forEach((date) => {
              dailyActivityLog[username][date] = true;
            });
            console.log(`[Legacy Streaks] ${username}: Backfilled ${activeDates.length} days to activity log`);
            activityLogUpdated = true;
            updated = true;
          }
        } catch (error) {
          console.error(`[Legacy Streaks] Error processing ${username}:`, error);
        }
      }

      if (updated || Object.keys(LEGACY_STREAK_CORRECTIONS).length > 0) {
        // Save updated streaks, activity log, and mark legacy corrections as applied
        const dataToSave = {
          previousStreaks: currentStreaks,
          legacyStreaksApplied: true,
        };

        if (activityLogUpdated) {
          dataToSave.dailyActivityLog = dailyActivityLog;
        }

        chrome.storage.local.set(dataToSave, () => {
          console.log('[Legacy Streaks] Corrections applied and marked complete');
          console.log('[Legacy Streaks] Final streaks:', currentStreaks);
          if (activityLogUpdated) {
            console.log('[Legacy Streaks] Activity log backfilled');
          }
          resolve();
        });
      } else {
        // No corrections to apply, just mark as done
        chrome.storage.local.set({ legacyStreaksApplied: true }, () => {
          console.log('[Legacy Streaks] No corrections needed');
          resolve();
        });
      }
    });
  });
}

/**
 * Listener for username submission
 *
 * Triggered when user clicks "Submit" button to enter their username at
 * beginning of extension.
 *
 * Checks if valid and fetch AC and leaderboard data.
 */
document.getElementById('submit-username').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(username);

  if (username) {
    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.set({ username: username }, async function () {
        console.log('Username is set to ' + username);
        currentUsername = username;
        const data = await getACSubmissions(username, 5);
        cachedActivitySubmissions = data;
        displayACSubmissions(data, username);
        showPage(getFirstEnabledPageId());

        // display leaderboard for first time, repeat code since DOM update already happened
        // Load in daily leaderboard data with timezone
        chrome.storage.local.get({ maxStrikes: 3, timezone: 'America/Chicago' }, async (result) => {
          const timezone = result.timezone;
          const maxStrikes = result.maxStrikes;

          // Load daily leaderboard data
          cachedDailyData = await loadDailyLeaderboardData([], username, timezone);

          // Load strikes users data
          document.getElementById('max-strikes-input').value = maxStrikes;
          document.getElementById('timezone-select').value = result.timezone;
          const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
            [],
            username,
            maxStrikes,
            timezone
          );
          cachedStrikesData = strikesUsers;
          cachedClearedStrikesData = clearedStrikesUsers;
          cachedStreaksData = streaksUsers;
          displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, username);

          // Load contest data
          const contestResult = await loadContestData([], username, timezone);
          cachedContestData = contestResult.contestData;
          displayContestLeaderboard(
            contestResult.contestData,
            contestResult.weekStart,
            contestResult.weekEnd,
            username
          );

          cachedGlobalRankingsData = await loadGlobalRankingsData([], username, timezone);
          displayGlobalRankings(cachedGlobalRankingsData, username);

          if (globalRankingsTimer) globalRankingsTimer.destroy();
          globalRankingsTimer = createUpdateTimer('global-rankings', getGlobalRankingCacheKeys([username]));

          // Load leaderboard data
          let leaderboardData = [await getUserProblemStats(username)];
          console.log(leaderboardData);

          // Fetch all profile pics
          leaderboardData = leaderboardData.map(async (stat) => {
            const userData = await getUserProfilePic(stat.username);
            const avatar = userData.userAvatar;
            return { ...stat, avatar };
          });

          const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
          Promise.all(leaderboardData).then((friendData) => {
            leaderboardTabs.forEach((tab) => {
              tab.addEventListener('click', () => {
                // once tab is clicked, change active and display new leaderboard data
                leaderboardTabs.forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                let difficulty = tab.getAttribute('data-difficulty');
                const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Daily: 4 };
                displayLeaderboard(friendData, cachedDailyData, username, diffMap[difficulty]);
              });
            });
            // load default tab as All for leaderboard
            const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
            defaultTab.classList.add('active');
            displayLeaderboard(friendData, null, username, 0);
          });
        });
      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});

/**
 * Listener for DOM Content Load (beginning of extension open)
 *
 * Validate current username, fetch AC submissions of self and friendss,
 * fetch friend list, and fetch leaderboard data
 */
document.addEventListener('DOMContentLoaded', async function () {
  // Clean up expired cache entries on popup open
  const removedCount = await cache.cleanExpired();
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} expired cache entries`);
  }

  // Initialize legacy streak corrections (runs once after update)
  await initializeLegacyStreaks();

  await initTabVisibilitySettings();

  // DISABLED COLOR SCHEME TOGGLE - light mode looks bad
  // document.getElementById('mode-toggle').addEventListener('change', function() {
  //     if (this.checked) {
  //         document.documentElement.setAttribute('data-theme', 'light');
  //     } else {
  //         document.documentElement.setAttribute('data-theme', 'dark');
  //     }
  // });

  // check if username is already stored, else prompt
  chrome.storage.local.get('username', async function (result) {
    if (!result.username) {
      showPage('username-input');
    } else {
      console.log('Welcome back, ' + result.username);
      // load in user AC data
      let allSubmissions = [];
      const data = await getACSubmissions(result.username, 5);
      allSubmissions = allSubmissions.concat(data);
      const currUsername = result.username;
      currentUsername = currUsername;

      // load in friend data
      chrome.storage.local.get({ friends: [] }, async (result) => {
        displayFriendsList(result.friends);

        // Load in AC data for activity page - CHANGE LIMIT BASED ON FRIENDS LIST
        // need to do this so promises resolve before updating in forEach
        Promise.all(result.friends.map((friend) => getACSubmissions(friend, 5))).then((friendData) => {
          friendData.forEach((submissions) => {
            allSubmissions = allSubmissions.concat(submissions);
          });
          cachedActivitySubmissions = allSubmissions;
          displayACSubmissions(allSubmissions, currUsername);
        });
        // default to first enabled tab
        showPage(getFirstEnabledPageId());

        // Initialize activity timer
        const allUsers = [currUsername, ...result.friends];
        if (activityTimer) activityTimer.destroy();
        activityTimer = createUpdateTimer('activity', getSubmissionsCacheKeys(allUsers, 5));

        // Load strikes users data with stored max strikes and timezone values
        chrome.storage.local.get({ maxStrikes: 3, timezone: 'America/Chicago' }, async (strikesResult) => {
          const maxStrikes = strikesResult.maxStrikes;
          const timezone = strikesResult.timezone;

          // Load in daily leaderboard data with timezone
          cachedDailyData = await loadDailyLeaderboardData(result.friends, currUsername, timezone);
          console.log(cachedDailyData);
          document.getElementById('max-strikes-input').value = maxStrikes;
          document.getElementById('timezone-select').value = strikesResult.timezone;
          const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
            result.friends,
            currUsername,
            maxStrikes,
            timezone
          );
          cachedStrikesData = strikesUsers;
          cachedClearedStrikesData = clearedStrikesUsers;
          cachedStreaksData = streaksUsers;
          displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, currUsername);

          // Load contest data
          const contestResult = await loadContestData(result.friends, currUsername, timezone);
          cachedContestData = contestResult.contestData;
          displayContestLeaderboard(
            contestResult.contestData,
            contestResult.weekStart,
            contestResult.weekEnd,
            currUsername
          );

          cachedGlobalRankingsData = await loadGlobalRankingsData(result.friends, currUsername, timezone);
          displayGlobalRankings(cachedGlobalRankingsData, currUsername);

          if (globalRankingsTimer) globalRankingsTimer.destroy();
          globalRankingsTimer = createUpdateTimer('global-rankings', getGlobalRankingCacheKeys(allUsers));

          // Initialize strikes timer (uses submissions for 30 items)
          if (strikesTimer) strikesTimer.destroy();
          strikesTimer = createUpdateTimer('strikes', getSubmissionsCacheKeys(allUsers, 30));
        });

        // Load in friend leaderboard data
        let leaderboardData = await getUserProblemStats(currUsername);
        Promise.all(result.friends.map((friend) => getUserProblemStats(friend))).then((friendData) => {
          // fetch profile pics for each user

          // for each tab listen for click
          const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
          friendData.push(leaderboardData);

          // Fetch all profile pics
          friendData = friendData.map(async (stat) => {
            const userData = await getUserProfilePic(stat.username);
            const avatar = userData.userAvatar;
            return { ...stat, avatar };
          });

          Promise.all(friendData).then((friendData) => {
            leaderboardTabs.forEach((tab) => {
              tab.addEventListener('click', () => {
                // once tab is clicked, change active and display new leaderboard data
                leaderboardTabs.forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                let difficulty = tab.getAttribute('data-difficulty');
                const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Daily: 4 };
                displayLeaderboard(friendData, cachedDailyData, currUsername, diffMap[difficulty]);
              });
            });
            // load default tab as All for leaderboard
            const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
            defaultTab.classList.add('active');
            displayLeaderboard(friendData, null, currUsername, 0);

            // Initialize leaderboard timer (combines user stats and daily submissions)
            if (leaderboardTimer) leaderboardTimer.destroy();
            const leaderboardCacheKeys = [...getUserStatsCacheKeys(allUsers), ...getSubmissionsCacheKeys(allUsers, 20)];
            leaderboardTimer = createUpdateTimer('leaderboard', leaderboardCacheKeys);
          });
        });
      });
    }
  });
});

/**
 * Loads daily leaderboard data for the current user and their friends.
 * Retrieves recent submissions for the current user and their friends,
 * filters them to include only today's submissions, and sorts the users
 * based on the count of their submissions.
 * @param {string[]} friends - An array of usernames representing the friends of the current user.
 * @param {string} username - The username of the current user.
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object[]} -An array of user objects containing daily leaderboard data.
 */
async function loadDailyLeaderboardData(friends, username, timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  let allSubmissions = [];

  // Get personal data
  const personalData = await getACSubmissions(username, 20);
  allSubmissions.push({
    username: username,
    submissions: personalData,
  });

  // Fetch past 20 submissions for each friend
  const friendDataPromises = friends.map(async (friend) => {
    const submissions = await getACSubmissions(friend, 20);
    const currFriend = submissions.length > 0 ? submissions[0].username : 'No Name';
    return {
      username: currFriend,
      submissions: submissions,
    };
  });

  // Wait for all friend data promises to resolve
  const friendData = await Promise.all(friendDataPromises);
  allSubmissions = allSubmissions.concat(friendData);

  // Fetch profile pics for all users
  const allSubmissionsWithAvatarPromises = allSubmissions.map(async (stat) => {
    const userData = await getUserProfilePic(stat.username);
    const avatar = userData.userAvatar;
    return { ...stat, avatar };
  });

  // Wait for all profile pic promises to resolve
  const allSubmissionsWithAvatar = await Promise.all(allSubmissionsWithAvatarPromises);

  // Now filter all submissions for each user using the specified timezone
  allSubmissionsWithAvatar.forEach((user) => {
    user.submissions = user.submissions.filter((submission) => isToday(submission.timestamp, timezone));
    user.count = user.submissions.length;
  });

  // Sort the submissions
  allSubmissionsWithAvatar.sort((x, y) => y.count - x.count);

  return allSubmissionsWithAvatar;
}

/**
 *  Helper function to filter submissions from today in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from today in the specified timezone
 */
function isToday(timestamp, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);
  const todayDate = getTodayInTimezone(timezone);
  return submissionDate === todayDate;
}

/**
 * Helper function to check if a timestamp is from yesterday in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from yesterday
 */
function isYesterday(timestamp, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);

  // Get yesterday's date in the specified timezone
  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const todayInTZ = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));
  todayInTZ.setUTCDate(todayInTZ.getUTCDate() - 1);

  const yesterdayStr = todayInTZ.toISOString().split('T')[0];

  return submissionDate === yesterdayStr;
}

/**
 * Helper function to check if a timestamp is from a specific day offset in specified timezone
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {number} daysAgo - Number of days before today (0 = today, 1 = yesterday, etc.)
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago")
 * @returns {boolean} - True if timestamp is from the specified day
 */
function isDaysAgo(timestamp, daysAgo, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);

  // Get the target date (daysAgo from today) in the specified timezone
  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const targetDate = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));
  targetDate.setUTCDate(targetDate.getUTCDate() - daysAgo);

  const targetDateStr = targetDate.toISOString().split('T')[0];

  return submissionDate === targetDateStr;
}

/**
 * Get daily activity log for a user
 * Returns whether they solved yesterday based on immutable daily records
 */
async function getDailyActivityLog(username, timezone) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyActivityLog'], (result) => {
      const log = result.dailyActivityLog || {};
      const yesterdayStr = getYesterdayInTimezone(timezone);

      const userLog = log[username] || {};
      const solvedYesterday = userLog[yesterdayStr] === true;

      resolve({ solvedYesterday });
    });
  });
}

/**
 * Record that a user solved a problem today
 * This creates an immutable record that won't change even if they re-solve
 */
async function recordDailyActivity(username, timezone) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyActivityLog'], (result) => {
      const log = result.dailyActivityLog || {};
      const todayStr = getTodayInTimezone(timezone);

      // Initialize user's log if needed
      if (!log[username]) {
        log[username] = {};
      }

      // Only set to true if not already set (immutable once set)
      if (!log[username][todayStr]) {
        log[username][todayStr] = true;

        // Clean up old entries (keep last 60 days only)
        const dates = Object.keys(log[username]).sort();
        if (dates.length > 60) {
          dates.slice(0, dates.length - 60).forEach((date) => {
            delete log[username][date];
          });
        }

        chrome.storage.local.set({ dailyActivityLog: log }, () => {
          console.log(`[Activity Log] Recorded activity for ${username} on ${todayStr}`);
          resolve();
        });
      } else {
        // Already recorded today
        resolve();
      }
    });
  });
}

/**
 * Get yesterday's date string in the specified timezone
 */
function getYesterdayInTimezone(timezone) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Format as YYYY-MM-DD in the specified timezone
  const dateStr = yesterday.toLocaleDateString('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return dateStr;
}

/**
 * Loads strikes users data - calculates consecutive days users haven't solved problems
 * starting from yesterday and checking up to maxStrikes days back.
 * Also calculates streaks - consecutive days users have solved problems.
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {number} maxStrikes - Maximum number of strikes to check (days back from yesterday)
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object} - Object containing strikesUsers, clearedStrikesUsers, and streaksUsers arrays
 */
async function loadStrikesUsersData(friends, username, maxStrikes = 3, timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  // Get today's date in the timezone for cache key
  const todayStr = getTodayInTimezone(timezone);

  // Create cache key based on all users, maxStrikes, and today's date
  const allUsers = [username, ...friends].sort();
  const cacheKey = `strikes_${allUsers.join('_')}_${maxStrikes}_${todayStr}`;

  // Check cache first
  const cachedData = await cache.get(cacheKey);
  if (cachedData !== null) {
    console.log(`Cache hit for strikes data: ${cacheKey}`);
    return cachedData;
  }

  console.log(`Cache miss for strikes data: ${cacheKey}, fetching from API`);

  // Load previous streak data for comparison
  const previousStreaksKey = 'previousStreaks';
  let previousStreaks = {};
  try {
    const storedData = await new Promise((resolve) => {
      chrome.storage.local.get([previousStreaksKey], (result) => {
        resolve(result[previousStreaksKey] || {});
      });
    });
    previousStreaks = storedData;
  } catch (error) {
    console.error('Error loading previous streaks:', error);
  }

  let strikesUsers = [];
  let clearedStrikesUsers = [];
  let streaksUsers = [];

  // Check each user
  for (const user of allUsers) {
    const submissions = await getACSubmissions(user, 30);

    // Check if user solved a problem today
    const todaySubmissions = submissions.filter((submission) => isToday(submission.timestamp, timezone));
    const clearsToday = todaySubmissions.length > 0;
    // Get the most recent submission from today (if any)
    const clearingSubmission = clearsToday ? todaySubmissions[0] : null;

    const userData = await getUserProfilePic(user);

    // Calculate streak FIRST - consecutive days with submissions
    let streakCount = 0;
    let lastProblemDate = null;
    let startDay = clearsToday ? 0 : 1; // Start from today if solved today, else yesterday

    for (let daysAgo = startDay; daysAgo < 30; daysAgo++) {
      const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));

      if (daySubmissions.length > 0) {
        streakCount++;
        // Capture the last problem date (most recent in the streak)
        if (lastProblemDate === null && daySubmissions.length > 0) {
          lastProblemDate = getLocalDateString(daySubmissions[0].timestamp, timezone);
        }
      } else {
        // Streak broken
        break;
      }
    }

    // Detect impossible streak drops (caused by re-solved problems changing dates)
    const previousStreak = previousStreaks[user] || 0;

    if (streakCount > 0 && previousStreak > streakCount) {
      // Streak dropped but didn't reset to 0 - this is impossible naturally
      // A real streak can only: stay same, increase by 1, or drop to 0
      // This means LeetCode API moved an old problem to today, creating a gap
      console.log(`[Streak Fix] ${user}: Detected impossible drop from ${previousStreak} to ${streakCount}`);

      if (clearsToday) {
        // They solved today, so streak should have increased
        streakCount = previousStreak + 1;
        console.log(`[Streak Fix] ${user}: Restored to ${streakCount} (previous + 1)`);
      } else {
        // They didn't solve today, maintain previous streak
        streakCount = previousStreak;
        console.log(`[Streak Fix] ${user}: Restored to ${streakCount} (maintained)`);
      }
    }

    // Count consecutive days starting from yesterday (up to maxStrikes days)
    let strikeCount = 0;
    for (let daysAgo = 1; daysAgo <= maxStrikes; daysAgo++) {
      const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));

      // If no submissions for this day, increment strike
      if (daySubmissions.length === 0) {
        strikeCount++;
      } else {
        // Stop counting if user was active (consecutive streak broken)
        break;
      }
    }

    // Check if user solved yesterday
    const yesterdaySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, 1, timezone));
    let solvedYesterday = yesterdaySubmissions.length > 0;

    // ACTIVITY LOG: Check if user actually solved yesterday (before any re-solves)
    // This is an immutable record set when they first solved, can't be changed by re-solves
    const activityLog = await getDailyActivityLog(user, timezone);
    const actuallysolvedYesterday = activityLog.solvedYesterday;

    // STRIKE FIX: Use activity log to determine real vs false strikes
    if (!solvedYesterday && actuallysolvedYesterday && clearsToday) {
      // Activity log says they solved yesterday, but LeetCode API doesn't show it
      // This means they re-solved that problem today (moved the date)
      console.log(`[Strike Fix] ${user}: Activity log confirms solved yesterday, clearing false strike`);
      solvedYesterday = true;
      strikeCount = 0;
    } else if (!solvedYesterday && !actuallysolvedYesterday && previousStreak > 0) {
      // They genuinely missed yesterday - this is a real strike
      console.log(`[Strike Fix] ${user}: Genuine miss yesterday (had ${previousStreak}-day streak)`);
    }

    // Record today's activity for tomorrow's calculation
    if (clearsToday) {
      await recordDailyActivity(user, timezone);
    }

    // Add to appropriate list
    if (strikeCount > 0) {
      // User has current strikes
      strikesUsers.push({
        username: user,
        avatar: userData.userAvatar,
        strikes: strikeCount,
        clearsToday: clearsToday,
        clearingSubmission: clearingSubmission,
      });
    } else if (solvedYesterday) {
      // User solved yesterday and has no current strikes
      // Check if they would have had strikes if they didn't solve yesterday
      // by checking if they have any missing days from day 2 onwards
      let wouldHaveHadStrikes = false;
      for (let daysAgo = 2; daysAgo <= maxStrikes + 1; daysAgo++) {
        const daySubmissions = submissions.filter((submission) => isDaysAgo(submission.timestamp, daysAgo, timezone));
        if (daySubmissions.length === 0) {
          // Found a gap - this means they would have had strikes
          wouldHaveHadStrikes = true;
          break;
        } else {
          // Found a submission - streak was broken, so no previous strikes
          break;
        }
      }

      // Only add to cleared list if they actually cleared strikes
      if (wouldHaveHadStrikes) {
        clearedStrikesUsers.push({
          username: user,
          avatar: userData.userAvatar,
          clearedStrikes: true,
        });
      }
    }

    // Add to streaks list if streak is 2 or more days
    if (streakCount >= 2) {
      streaksUsers.push({
        username: user,
        avatar: userData.userAvatar,
        streak: streakCount,
        lastProblemDate: lastProblemDate,
      });
    }
  }

  // Sort by strikes descending (most strikes first)
  strikesUsers.sort((a, b) => b.strikes - a.strikes);

  // Sort streaks by streak count descending (longest streak first)
  streaksUsers.sort((a, b) => b.streak - a.streak);

  const result = { strikesUsers, clearedStrikesUsers, streaksUsers };

  // Save current streaks for future comparison
  const newPreviousStreaks = {};
  streaksUsers.forEach((user) => {
    newPreviousStreaks[user.username] = user.streak;
  });
  // Also save users with no streaks as 0
  allUsers.forEach((user) => {
    if (!newPreviousStreaks[user]) {
      newPreviousStreaks[user] = 0;
    }
  });

  try {
    await new Promise((resolve) => {
      chrome.storage.local.set({ [previousStreaksKey]: newPreviousStreaks }, () => {
        console.log('[Streak Fix] Saved current streaks for future comparison');
        resolve();
      });
    });
  } catch (error) {
    console.error('Error saving previous streaks:', error);
  }

  // Calculate TTL: 10 minutes, but not past midnight in the user's timezone
  const ttlUntilMidnight = getTTLUntilMidnight(timezone);
  const ttl = Math.min(TTL.SUBMISSIONS, ttlUntilMidnight);

  // Cache the result
  await cache.set(cacheKey, result, ttl);

  return result;
}

/**
 * Helper function to get the start and end of the current week (Monday-Sunday)
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object} - Object containing weekStart and weekEnd Date objects
 */
function getCurrentWeekBounds(timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  // Get today in the specified timezone
  const todayStr = getTodayInTimezone(timezone);
  const todayParts = todayStr.split('-');
  const today = new Date(Date.UTC(parseInt(todayParts[0]), parseInt(todayParts[1]) - 1, parseInt(todayParts[2])));

  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayOfWeek = today.getUTCDay();

  // Calculate days since Monday (Monday = 1, so adjust for Monday being start of week)
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // Calculate Monday of this week
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - daysSinceMonday);

  // Calculate Sunday of this week
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return { weekStart, weekEnd };
}

/**
 * Helper function to check if a timestamp is within the current week (Monday-Sunday)
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {Date} weekStart - Start of week (Monday)
 * @param {Date} weekEnd - End of week (Sunday)
 * @param {string} timezone - IANA timezone string
 * @returns {boolean} - True if timestamp is within the current week
 */
function isInCurrentWeek(timestamp, weekStart, weekEnd, timezone) {
  const submissionDate = getLocalDateString(timestamp, timezone);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  return submissionDate >= weekStartStr && submissionDate <= weekEndStr;
}

/**
 * Loads contest leaderboard data for the current week (Monday-Sunday)
 * Calculates points based on difficulty: Easy = 1pt, Medium = 3pt, Hard = 6pt
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @returns {object} - Object containing contestData array and week info
 */
async function loadContestData(friends, username, timezone = 'America/Chicago') {
  // Handle auto-detect timezone
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const { weekStart, weekEnd } = getCurrentWeekBounds(timezone);
  const weekStartFormatted = weekStart.toISOString().split('T')[0];
  const weekEndFormatted = weekEnd.toISOString().split('T')[0];

  // Create cache key based on all users and current week
  const allUsers = [username, ...friends].sort();
  const cacheKey = `contest_${allUsers.join('_')}_${weekStartFormatted}`;

  // Check cache first
  const cachedData = await cache.get(cacheKey);
  if (cachedData !== null) {
    console.log(`Cache hit for contest data: ${cacheKey}`);
    return cachedData;
  }

  console.log(`Cache miss for contest data: ${cacheKey}, fetching from API`);

  const contestData = [];

  // Fetch submissions for each user
  for (const user of allUsers) {
    const submissions = await getACSubmissions(user, 50); // Get more submissions to cover the week
    const userData = await getUserProfilePic(user);

    // Filter submissions for current week
    const weekSubmissions = submissions.filter((submission) =>
      isInCurrentWeek(submission.timestamp, weekStart, weekEnd, timezone)
    );

    // Calculate points for each submission
    let totalPoints = 0;
    const problemsWithDifficulty = await Promise.all(
      weekSubmissions.map(async (submission) => {
        const problemData = await questionDifficulty(submission.titleSlug);
        const difficulty = problemData.difficulty;
        let points = 0;

        if (difficulty === 'Easy') points = 1;
        else if (difficulty === 'Medium') points = 3;
        else if (difficulty === 'Hard') points = 6;

        totalPoints += points;

        return { ...submission, difficulty, points };
      })
    );

    contestData.push({
      username: user,
      avatar: userData.userAvatar,
      points: totalPoints,
      submissions: problemsWithDifficulty,
      submissionCount: weekSubmissions.length,
    });
  }

  // Sort by points descending
  contestData.sort((a, b) => b.points - a.points);

  const result = {
    contestData,
    weekStart: weekStartFormatted,
    weekEnd: weekEndFormatted,
  };

  // Cache the result with 30-minute TTL
  await cache.set(cacheKey, result, TTL.CONTEST);

  return result;
}

/**
 * Finds the most recent stored rank before today for a user.
 * @param {Object} userDates - Map of YYYY-MM-DD to rank
 * @param {string} todayStr - Today's date string
 * @returns {{ rank: number, date: string } | null}
 */
function getMostRecentPriorRank(userDates, todayStr) {
  if (!userDates) {
    return null;
  }

  const priorDates = Object.keys(userDates)
    .filter((date) => date < todayStr)
    .sort();

  if (priorDates.length === 0) {
    return null;
  }

  const date = priorDates[priorDates.length - 1];
  return { rank: userDates[date], date };
}

/**
 * Loads problem-solving rank data for the current user and their friends.
 * Compares current ranks against the most recent prior daily snapshot, or last view.
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {string} timezone - IANA timezone string (e.g., "America/Chicago") or 'auto' for auto-detect
 * @param {object} options - Optional settings
 * @param {boolean} options.updateSnapshots - Whether to persist new rank snapshots (default true)
 * @returns {object[]} - An array of user objects with problem rank data and change info
 */
async function loadGlobalRankingsData(friends, username, timezone = 'America/Chicago', options = {}) {
  const { updateSnapshots = true } = options;
  if (timezone === 'auto') {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const allUsers = [username, ...friends];
  const todayStr = getTodayInTimezone(timezone);

  const storageResult = await new Promise((resolve) => {
    chrome.storage.local.get(['problemRankSnapshots'], resolve);
  });
  const problemRankSnapshots = storageResult.problemRankSnapshots || { lastViewed: {}, byDate: {} };

  const rankingsPromises = allUsers.map(async (user) => {
    const rankingData = await getGlobalRanking(user);
    const userData = await getUserProfilePic(user);

    let rankChange = null;
    let changeSource = null;
    let changeReferenceDate = null;

    if (rankingData.problemRank !== null) {
      const priorSnapshot = getMostRecentPriorRank(problemRankSnapshots.byDate?.[user], todayStr);

      if (priorSnapshot !== null) {
        rankChange = priorSnapshot.rank - rankingData.problemRank;
        changeSource = 'priorDay';
        changeReferenceDate = priorSnapshot.date;
      } else if (problemRankSnapshots.lastViewed?.[user] !== undefined) {
        rankChange = problemRankSnapshots.lastViewed[user] - rankingData.problemRank;
        changeSource = 'lastView';
      }
    }

    return {
      ...rankingData,
      avatar: userData.userAvatar,
      rankChange,
      changeSource,
      changeReferenceDate,
    };
  });

  const rankingsData = await Promise.all(rankingsPromises);

  if (!updateSnapshots) {
    return rankingsData;
  }

  const updatedSnapshots = {
    lastViewed: { ...(problemRankSnapshots.lastViewed || {}) },
    byDate: { ...(problemRankSnapshots.byDate || {}) },
  };

  rankingsData.forEach((user) => {
    if (user.problemRank !== null) {
      updatedSnapshots.lastViewed[user.username] = user.problemRank;

      if (!updatedSnapshots.byDate[user.username]) {
        updatedSnapshots.byDate[user.username] = {};
      }
      updatedSnapshots.byDate[user.username][todayStr] = user.problemRank;

      const dates = Object.keys(updatedSnapshots.byDate[user.username]).sort();
      if (dates.length > 60) {
        dates.slice(0, dates.length - 60).forEach((date) => {
          delete updatedSnapshots.byDate[user.username][date];
        });
      }
    }
  });

  await new Promise((resolve) => {
    chrome.storage.local.set({ problemRankSnapshots: updatedSnapshots }, resolve);
  });

  return rankingsData;
}

/**
 * Listener for add friend button
 *
 * Check if the entered username is valid, if so add, else throw error
 */
document.getElementById('add-friend-btn').addEventListener('click', async () => {
  const friendUsername = document.getElementById('friend-username').value.trim();

  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(friendUsername);

  if (friendUsername) {
    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.get({ friends: [] }, (result) => {
        const friends = result.friends;
        if (!friends.includes(friendUsername)) {
          friends.push(friendUsername);
          chrome.storage.local.set({ friends }, () => {
            console.log(`Friend ${friendUsername} added.`);
            displayFriendsList(friends);
          });
        } else {
          console.log(`Friend ${friendUsername} is already in the list.`);
        }
      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});

/**
 * Listener for update max strikes button
 */
document.getElementById('update-max-strikes-btn').addEventListener('click', async () => {
  const maxStrikesInput = document.getElementById('max-strikes-input');
  const maxStrikes = parseInt(maxStrikesInput.value);

  if (maxStrikes < 1 || maxStrikes > 30) {
    alert('Please enter a value between 1 and 30');
    return;
  }

  // Store the max strikes value
  chrome.storage.local.set({ maxStrikes: maxStrikes }, async () => {
    console.log('Max strikes set to ' + maxStrikes);

    // Reload strikes data with new max value and current timezone
    chrome.storage.local.get(['username', 'friends', 'timezone'], async (result) => {
      if (result.username) {
        const timezone = result.timezone || 'America/Chicago';
        const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
          result.friends || [],
          result.username,
          maxStrikes,
          timezone
        );
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        cachedStreaksData = streaksUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, result.username);
      }
    });
  });
});

/**
 * Listener for timezone setting change
 */
document.getElementById('timezone-select').addEventListener('change', async () => {
  const timezoneSelect = document.getElementById('timezone-select');
  const selectedTimezone = timezoneSelect.value;

  // Store the timezone value
  chrome.storage.local.set({ timezone: selectedTimezone }, async () => {
    console.log('Timezone set to ' + selectedTimezone);

    // Reload strikes data with new timezone
    chrome.storage.local.get(['username', 'friends', 'maxStrikes'], async (result) => {
      if (result.username) {
        const maxStrikes = result.maxStrikes || 3;
        const timezone = selectedTimezone;
        const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
          result.friends || [],
          result.username,
          maxStrikes,
          timezone
        );
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        cachedStreaksData = streaksUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, result.username);
      }
    });
  });
});

/**
 * Listener for copy strikes button
 */
let cachedStrikesData = [];
let cachedClearedStrikesData = [];
let cachedStreaksData = [];
let cachedDailyData = null;
let cachedContestData = [];
let cachedGlobalRankingsData = [];
let cachedActivitySubmissions = [];
let currentUsername = '';

document.getElementById('copy-strikes-btn').addEventListener('click', () => {
  if (
    (!cachedStrikesData || cachedStrikesData.length === 0) &&
    (!cachedClearedStrikesData || cachedClearedStrikesData.length === 0) &&
    (!cachedStreaksData || cachedStreaksData.length === 0)
  ) {
    alert('No data to copy!');
    return;
  }

  // Build the formatted text
  let clipboardText = '';

  // Add streaks first (sorted by streak count descending)
  if (cachedStreaksData && cachedStreaksData.length > 0) {
    cachedStreaksData.forEach((user) => {
      clipboardText += `${user.username} 🔥[${user.streak}]\n`;
    });
    clipboardText += '\n';
  }

  // Add cleared strikes users (with checkmark)
  if (cachedClearedStrikesData && cachedClearedStrikesData.length > 0) {
    cachedClearedStrikesData.forEach((user) => {
      clipboardText += `${user.username} ✅\n`;
    });
    clipboardText += '\n';
  }

  // Group users by strike count
  const strikeGroups = {};
  cachedStrikesData.forEach((user) => {
    if (!strikeGroups[user.strikes]) {
      strikeGroups[user.strikes] = [];
    }
    strikeGroups[user.strikes].push(user.username);
  });

  // Sort strike numbers in ascending order
  const sortedStrikeNumbers = Object.keys(strikeGroups)
    .map(Number)
    .sort((a, b) => a - b);

  // Add strikes sections
  sortedStrikeNumbers.forEach((strikeCount) => {
    const emojis = '❌'.repeat(strikeCount);
    clipboardText += `Strike ${strikeCount} ${emojis}:\n`;
    strikeGroups[strikeCount].forEach((username) => {
      clipboardText += `${username}\n`;
    });
    clipboardText += '\n';
  });

  // Copy to clipboard
  navigator.clipboard
    .writeText(clipboardText.trim())
    .then(() => {
      // Visual feedback
      const button = document.getElementById('copy-strikes-btn');
      const originalText = button.textContent;
      button.textContent = '✓';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1000);
    })
    .catch((err) => {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    });
});

/**
 * Listener for refresh all data button in settings
 */
document.getElementById('refresh-all-btn').addEventListener('click', async () => {
  const button = document.getElementById('refresh-all-btn');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '⏳ Refreshing...';

  try {
    chrome.storage.local.get(['username', 'friends', 'maxStrikes', 'timezone'], async (result) => {
      const username = result.username;
      const friends = result.friends || [];
      const maxStrikes = result.maxStrikes || 3;
      const timezone = result.timezone || 'America/Chicago';
      const allUsers = [username, ...friends];

      // Clear all caches
      for (const user of allUsers) {
        await cache.delete(`submissions_${user}_5`);
        await cache.delete(`submissions_${user}_20`);
        await cache.delete(`submissions_${user}_30`);
        await cache.delete(`submissions_${user}_50`);
        await cache.delete(`user_stats_${user}`);
        await cache.delete(`problem_ranking_${user}`);
      }

      // Clear contest cache
      const { weekStart } = getCurrentWeekBounds(timezone);
      const weekStartFormatted = weekStart.toISOString().split('T')[0];
      const sortedUsers = [...allUsers].sort();
      const contestCacheKey = `contest_${sortedUsers.join('_')}_${weekStartFormatted}`;
      await cache.delete(contestCacheKey);

      // Clear strikes cache
      const todayStr = getTodayInTimezone(timezone);
      const strikesCacheKey = `strikes_${sortedUsers.join('_')}_${maxStrikes}_${todayStr}`;
      await cache.delete(strikesCacheKey);

      // Reload all data
      // Activity
      currentUsername = username;
      let allSubmissions = [];
      const data = await getACSubmissions(username, 5);
      allSubmissions = allSubmissions.concat(data);
      const friendDataPromises = friends.map((friend) => getACSubmissions(friend, 5));
      const friendData = await Promise.all(friendDataPromises);
      friendData.forEach((submissions) => {
        allSubmissions = allSubmissions.concat(submissions);
      });
      cachedActivitySubmissions = allSubmissions;
      displayACSubmissions(allSubmissions, username);

      // Leaderboard
      cachedDailyData = await loadDailyLeaderboardData(friends, username, timezone);
      let leaderboardData = await getUserProblemStats(username);
      const leaderboardFriendPromises = friends.map((friend) => getUserProblemStats(friend));
      const leaderboardFriendData = await Promise.all(leaderboardFriendPromises);
      leaderboardFriendData.push(leaderboardData);

      const friendDataWithAvatars = leaderboardFriendData.map(async (stat) => {
        const userData = await getUserProfilePic(stat.username);
        const avatar = userData.userAvatar;
        return { ...stat, avatar };
      });
      const friendDataResolved = await Promise.all(friendDataWithAvatars);

      // Update leaderboard tabs
      const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
      leaderboardTabs.forEach((tab) => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
      });

      document.querySelectorAll('.leaderboard-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.leaderboard-tab').forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          let difficulty = tab.getAttribute('data-difficulty');
          const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Daily: 4 };
          displayLeaderboard(friendDataResolved, cachedDailyData, username, diffMap[difficulty]);
        });
      });

      const activeTab = document.querySelector('.leaderboard-tab.active');
      const difficulty = activeTab ? activeTab.getAttribute('data-difficulty') : 'All';
      const diffMap = { All: 0, Easy: 1, Medium: 2, Hard: 3, Daily: 4 };
      displayLeaderboard(friendDataResolved, cachedDailyData, username, diffMap[difficulty]);

      // Strikes
      const { strikesUsers, clearedStrikesUsers, streaksUsers } = await loadStrikesUsersData(
        friends,
        username,
        maxStrikes,
        timezone
      );
      cachedStrikesData = strikesUsers;
      cachedClearedStrikesData = clearedStrikesUsers;
      cachedStreaksData = streaksUsers;
      displayStrikesUsers(strikesUsers, clearedStrikesUsers, streaksUsers, username);

      // Contest
      const contestResult = await loadContestData(friends, username, timezone);
      cachedContestData = contestResult.contestData;
      displayContestLeaderboard(contestResult.contestData, contestResult.weekStart, contestResult.weekEnd, username);

      cachedGlobalRankingsData = await loadGlobalRankingsData(friends, username, timezone, {
        updateSnapshots: false,
      });
      displayGlobalRankings(cachedGlobalRankingsData, username);

      // Restart all timers
      if (activityTimer) activityTimer.destroy();
      activityTimer = createUpdateTimer('activity', getSubmissionsCacheKeys(allUsers, 5));

      if (leaderboardTimer) leaderboardTimer.destroy();
      const leaderboardCacheKeys = [...getUserStatsCacheKeys(allUsers), ...getSubmissionsCacheKeys(allUsers, 20)];
      leaderboardTimer = createUpdateTimer('leaderboard', leaderboardCacheKeys);

      if (strikesTimer) strikesTimer.destroy();
      strikesTimer = createUpdateTimer('strikes', getSubmissionsCacheKeys(allUsers, 30));

      if (globalRankingsTimer) globalRankingsTimer.destroy();
      globalRankingsTimer = createUpdateTimer('global-rankings', getGlobalRankingCacheKeys(allUsers));

      button.disabled = false;
      button.textContent = originalText;
      alert('All data refreshed successfully!');
    });
  } catch (error) {
    console.error('Error refreshing all data:', error);
    button.disabled = false;
    button.textContent = originalText;
    alert('Error refreshing data. Please try again.');
  }
});

/**
 * Listener for tab changes
 */
document.getElementById('activity-tab').addEventListener('click', () => showPage('activity'));
document.getElementById('leaderboard-tab').addEventListener('click', () => showPage('leaderboard'));
document.getElementById('contest-tab').addEventListener('click', () => showPage('contest'));
document.getElementById('global-rankings-tab').addEventListener('click', () => showPage('global-rankings'));
document.getElementById('strikes-tab').addEventListener('click', () => showPage('strikes'));

/**
 * Listener for settings icon in navbar
 */
document.getElementById('settings-icon').addEventListener('click', () => showPage('settings'));

document.getElementById('tab-visibility-toggles').addEventListener('change', async (event) => {
  const checkbox = event.target;
  if (!checkbox.matches('[data-tab-key]')) {
    return;
  }

  const key = checkbox.dataset.tabKey;
  const enabledTabs = await getEnabledTabs();

  if (!checkbox.checked) {
    const enabledCount = Object.values(enabledTabs).filter(Boolean).length;
    if (enabledCount <= 1) {
      checkbox.checked = true;
      return;
    }
  }

  enabledTabs[key] = checkbox.checked;
  await saveEnabledTabs(enabledTabs);
  applyTabVisibility(enabledTabs);
});

/**
 * Listener for activity search filter
 */
document.getElementById('activity-search').addEventListener('input', (e) => {
  const filterText = e.target.value;
  displayACSubmissions(cachedActivitySubmissions, currentUsername, filterText);
});

/**
 * Listener for clear filter button
 */
document.getElementById('activity-clear-filter').addEventListener('click', () => {
  document.getElementById('activity-search').value = '';
  displayACSubmissions(cachedActivitySubmissions, currentUsername, '');
});

/**
 * Changes which page is shown as content based off tab bar.
 * @param {String} pageId - The id of the page chosen.
 */
function showPage(pageId) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('active');
  });

  document.querySelectorAll('.page').forEach((page) => {
    page.classList.remove('active');
  });

  document.getElementById(pageId).classList.add('active');
  // Settings page doesn't have a tab, it's triggered by the cogwheel icon
  if (pageId === 'username-input' || pageId === 'settings') {
    return;
  }
  const activeTabId = `${pageId.concat('-tab')}`;
  document.getElementById(activeTabId).classList.add('active');
}

